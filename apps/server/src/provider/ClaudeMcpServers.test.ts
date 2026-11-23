import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ClaudeConnectorsError,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";

import * as ServerConfig from "../config.ts";
import * as Settings from "../serverSettings.ts";
import * as ClaudeMcpServers from "./ClaudeMcpServers.ts";

const CLAUDE = ProviderInstanceId.make("claudeAgent");

interface SpawnedCommand {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd: string | undefined;
  readonly env: NodeJS.ProcessEnv | undefined;
  readonly stdin: Array<string>;
}

const makeSpawner = (calls: Array<SpawnedCommand>, exitCode = 0) =>
  ChildProcessSpawner.make((raw) =>
    Effect.sync(() => {
      const command = raw as unknown as {
        readonly command: string;
        readonly args: ReadonlyArray<string>;
        readonly options: { readonly cwd?: string; readonly env?: NodeJS.ProcessEnv };
      };
      const stdin: Array<string> = [];
      calls.push({
        command: command.command,
        args: command.args,
        cwd: command.options.cwd,
        env: command.options.env,
        stdin,
      });
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.succeed(Effect.void),
        stdin: Sink.forEach((chunk: Uint8Array) =>
          Effect.sync(() => stdin.push(new TextDecoder().decode(chunk))),
        ),
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
      });
    }),
  );

interface FakePty {
  readonly input: PtyAdapter.PtySpawnInput;
  readonly writes: Array<string>;
  killed: boolean;
  onWrite: (data: string) => void;
  emit: (data: string) => void;
  exit: (code: number) => void;
}

const makePtyAdapter = Effect.gen(function* () {
  const spawned = yield* Queue.unbounded<FakePty>();
  const adapter = PtyAdapter.PtyAdapter.of({
    spawn: (input) =>
      Effect.sync(() => {
        const dataListeners = new Set<(data: string) => void>();
        const exitListeners = new Set<(event: PtyAdapter.PtyExitEvent) => void>();
        const fake: FakePty = {
          input,
          writes: [],
          killed: false,
          onWrite: () => {},
          emit: (data) => dataListeners.forEach((listener) => listener(data)),
          exit: (exitCode) =>
            exitListeners.forEach((listener) => listener({ exitCode, signal: null })),
        };
        Queue.offerUnsafe(spawned, fake);
        return {
          pid: 1,
          write: (data) => {
            const text = String(data);
            fake.writes.push(text);
            fake.onWrite(text);
          },
          resize: () => {},
          kill: () => {
            fake.killed = true;
          },
          onData: (listener) => {
            dataListeners.add(listener);
            return () => dataListeners.delete(listener);
          },
          onExit: (listener) => {
            exitListeners.add(listener);
            return () => exitListeners.delete(listener);
          },
        } satisfies PtyAdapter.PtyProcess;
      }),
  });
  return { adapter, spawned };
});

const testCrypto = SecureRandom.SecureRandom.of({
  nextIntUnsafe: () => 0,
  nextDoubleUnsafe: () => 0,
  randomBytes: (size: number) => Effect.succeed(new Uint8Array(size)),
  uuidV4: (() => {
    let next = 0;
    return () => Effect.sync(() => `sign-in-${++next}`);
  })(),
} as unknown as SecureRandom.SecureRandom["Service"]);

const serviceLayer = (input: {
  readonly instances?: Record<string, ProviderInstanceConfig>;
  readonly calls?: Array<SpawnedCommand>;
  readonly exitCode?: number;
  readonly pty?: PtyAdapter.PtyAdapter["Service"];
}) => {
  const base = Layer.mergeAll(
    Settings.ServerSettingsService.layerTest({
      providerInstances: input.instances ?? {},
    } as never),
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-claude-mcp-servers-" }),
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      makeSpawner(input.calls ?? [], input.exitCode),
    ),
    Layer.succeed(SecureRandom.SecureRandom, testCrypto),
    input.pty === undefined ? Layer.empty : Layer.succeed(PtyAdapter.PtyAdapter, input.pty),
  );
  return ClaudeMcpServers.layer.pipe(
    Layer.provideMerge(base),
    Layer.provideMerge(NodeServices.layer),
    Layer.orDie,
  );
};

const claudeHome = (homePath: string, extra: Record<string, unknown> = {}) => ({
  claudeAgent: {
    driver: ProviderDriverKind.make("claudeAgent"),
    config: { homePath, ...extra },
  },
});

const FIXTURE = {
  oauthAccount: { organizationUuid: "org" },
  mcpServers: {
    web: {
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer SECRET-HEADER" },
    },
    events: { type: "sse", url: "https://sse.example.com/sse" },
    local: {
      type: "stdio",
      command: "npx",
      args: ["-y", "server"],
      env: { API_KEY: "SECRET-ENV" },
    },
    legacy: { command: "node", args: ["server.js"] },
    odd: { type: "carrier-pigeon" },
  },
};

const tempHome = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.makeTempDirectoryScoped({ prefix: "t3-claude-home-" });
});

const writeJson = (filePath: string, value: unknown) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) =>
    fs.writeFileString(filePath, typeof value === "string" ? value : JSON.stringify(value)),
  );

const failureReason = <A>(effect: Effect.Effect<A, ClaudeConnectorsError>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

const withHost = <A, E, R>(home: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideService(HostProcess.HomeDirectory, home),
    Effect.provideService(HostProcess.Environment, { PATH: "/usr/bin:/bin" }),
  );

describe("ClaudeMcpServers.list", () => {
  it.effect("summarizes every transport without env or header values", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const dir = yield* tempHome;
      yield* writeJson(path.join(dir, ".claude.json"), FIXTURE);
      const state = yield* withHost(
        dir,
        ClaudeMcpServers.ClaudeMcpServers.use((servers) => servers.list({ instanceId: CLAUDE })),
      ).pipe(Effect.provide(serviceLayer({ instances: claudeHome(dir) })));
      expect(state.configDir).toBe(dir);
      expect(state.accountConnectorsEnabled).toBe(true);
      expect(state.servers).toEqual([
        {
          name: "web",
          transport: "http",
          target: "https://mcp.example.com/mcp",
          secretNames: ["Authorization"],
          canSignIn: true,
        },
        {
          name: "events",
          transport: "sse",
          target: "https://sse.example.com/sse",
          secretNames: [],
          canSignIn: true,
        },
        {
          name: "local",
          transport: "stdio",
          target: "npx -y server",
          secretNames: ["API_KEY"],
          canSignIn: false,
        },
        {
          name: "legacy",
          transport: "stdio",
          target: "node server.js",
          secretNames: [],
          canSignIn: false,
        },
        { name: "odd", transport: "unknown", target: "", secretNames: [], canSignIn: false },
      ]);
      expect(JSON.stringify(state)).not.toContain("SECRET");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reads ~/.claude.json without a custom home and <dir>/.claude.json with one", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const home = yield* tempHome;
      const custom = yield* tempHome;
      yield* writeJson(path.join(home, ".claude.json"), {
        mcpServers: { inHome: { type: "http", url: "https://a.example.com" } },
      });
      yield* writeJson(path.join(custom, ".claude.json"), {
        mcpServers: { inCustom: { type: "http", url: "https://b.example.com" } },
      });
      const listNames = (instances: Record<string, ProviderInstanceConfig>) =>
        withHost(
          home,
          ClaudeMcpServers.ClaudeMcpServers.use((servers) => servers.list({ instanceId: CLAUDE })),
        ).pipe(
          Effect.map((state) => ({
            configDir: state.configDir,
            names: state.servers.map((s) => s.name),
          })),
          Effect.provide(serviceLayer({ instances })),
        );
      expect(yield* listNames({})).toEqual({
        configDir: path.join(home, ".claude"),
        names: ["inHome"],
      });
      expect(yield* listNames(claudeHome(custom))).toEqual({
        configDir: custom,
        names: ["inCustom"],
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("treats a missing file as empty and an unparseable one as unreadable", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const dir = yield* tempHome;
      const list = withHost(
        dir,
        ClaudeMcpServers.ClaudeMcpServers.use((servers) => servers.list({ instanceId: CLAUDE })),
      ).pipe(Effect.provide(serviceLayer({ instances: claudeHome(dir) })));
      expect((yield* list).servers).toEqual([]);
      yield* writeJson(path.join(dir, ".claude.json"), "{not json");
      expect(yield* failureReason(list)).toBe("ConfigUnreadable");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses unknown and non-Claude instances", () =>
    Effect.gen(function* () {
      const dir = yield* tempHome;
      const list = (instanceId: string) =>
        failureReason(
          withHost(
            dir,
            ClaudeMcpServers.ClaudeMcpServers.use((servers) =>
              servers.list({ instanceId: ProviderInstanceId.make(instanceId) }),
            ),
          ).pipe(
            Effect.provide(
              serviceLayer({ instances: { codex: { driver: ProviderDriverKind.make("codex") } } }),
            ),
          ),
        );
      expect(yield* list("codex")).toBe("NotClaudeInstance");
      expect(yield* list("missing")).toBe("InstanceNotFound");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("ClaudeMcpServers writes", () => {
  it.effect("adds through add-json with the instance's binary and config directory", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const dir = yield* tempHome;
      const calls: Array<SpawnedCommand> = [];
      const layer = serviceLayer({
        instances: claudeHome(dir, { binaryPath: "/opt/claude/bin/claude" }),
        calls,
      });
      const context = yield* Layer.build(layer);
      const { stateDir } = yield* ServerConfig.ServerConfig.pipe(Effect.provide(context));
      yield* withHost(
        dir,
        ClaudeMcpServers.ClaudeMcpServers.use((servers) =>
          Effect.all([
            servers.add({
              instanceId: CLAUDE,
              name: "local",
              definition: {
                transport: "stdio",
                command: "npx",
                args: ["-y", "server"],
                env: [{ name: "API_KEY", value: "k" }],
              },
            }),
            servers.add({
              instanceId: CLAUDE,
              name: "web",
              definition: {
                transport: "http",
                url: "https://mcp.example.com/mcp",
                headers: [{ name: "Authorization", value: "Bearer t" }],
              },
            }),
          ]),
        ),
      ).pipe(Effect.provide(context));
      // Secrets go over stdin: any local user can read another process's argv.
      expect(
        calls.map(({ command, args, stdin }) => ({ command, args, stdin: stdin.join("") })),
      ).toEqual([
        {
          command: "/opt/claude/bin/claude",
          args: ["mcp", "add-json", "local", "-", "--scope", "user"],
          stdin: JSON.stringify({
            type: "stdio",
            command: "npx",
            args: ["-y", "server"],
            env: { API_KEY: "k" },
          }),
        },
        {
          command: "/opt/claude/bin/claude",
          args: ["mcp", "add-json", "web", "-", "--scope", "user"],
          stdin: JSON.stringify({
            type: "http",
            url: "https://mcp.example.com/mcp",
            headers: { Authorization: "Bearer t" },
          }),
        },
      ]);
      expect(calls[0]?.env?.CLAUDE_CONFIG_DIR).toBe(dir);
      expect(calls[0]?.cwd).toBe(stateDir);

      yield* writeJson(path.join(dir, ".claude.json"), FIXTURE);
      expect(
        yield* failureReason(
          withHost(
            dir,
            ClaudeMcpServers.ClaudeMcpServers.use((servers) =>
              servers.add({
                instanceId: CLAUDE,
                name: "web",
                definition: { transport: "sse", url: "https://x.example.com", headers: [] },
              }),
            ),
          ).pipe(Effect.provide(context)),
        ),
      ).toBe("NameTaken");
      expect(calls).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves CLAUDE_CONFIG_DIR unset without a custom home", () =>
    Effect.gen(function* () {
      const home = yield* tempHome;
      const calls: Array<SpawnedCommand> = [];
      yield* withHost(
        home,
        ClaudeMcpServers.ClaudeMcpServers.use((servers) =>
          servers.add({
            instanceId: CLAUDE,
            name: "web",
            definition: { transport: "http", url: "https://mcp.example.com", headers: [] },
          }),
        ),
      ).pipe(Effect.provide(serviceLayer({ calls })));
      expect(calls[0]?.command).toBe("claude");
      expect(calls[0]?.env).not.toHaveProperty("CLAUDE_CONFIG_DIR");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("removes and signs out by name, and refuses names it does not list", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const dir = yield* tempHome;
      yield* writeJson(path.join(dir, ".claude.json"), FIXTURE);
      const calls: Array<SpawnedCommand> = [];
      const layer = serviceLayer({ instances: claudeHome(dir), calls });
      const run = <A>(
        use: (
          servers: ClaudeMcpServers.ClaudeMcpServers["Service"],
        ) => Effect.Effect<A, ClaudeConnectorsError>,
      ) => withHost(dir, ClaudeMcpServers.ClaudeMcpServers.use(use)).pipe(Effect.provide(layer));
      yield* run((servers) => servers.remove({ instanceId: CLAUDE, name: "local" }));
      yield* run((servers) => servers.signOut({ instanceId: CLAUDE, name: "web" }));
      expect(calls.map((call) => call.args)).toEqual([
        ["mcp", "remove", "local", "--scope", "user"],
        ["mcp", "logout", "web"],
      ]);
      expect(
        yield* failureReason(
          run((servers) => servers.remove({ instanceId: CLAUDE, name: "gone" })),
        ),
      ).toBe("NotFound");
      expect(calls).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a failing CLI without its output", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const dir = yield* tempHome;
      yield* writeJson(path.join(dir, ".claude.json"), FIXTURE);
      const error = yield* withHost(
        dir,
        ClaudeMcpServers.ClaudeMcpServers.use((servers) =>
          servers.remove({ instanceId: CLAUDE, name: "local" }),
        ),
      ).pipe(
        Effect.provide(serviceLayer({ instances: claudeHome(dir), exitCode: 1 })),
        Effect.flip,
      );
      expect(error.reason).toBe("CliFailed");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("switches account connectors and keeps other settings", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* tempHome;
      const settingsPath = path.join(dir, "settings.json");
      const set = (enabled: boolean) =>
        withHost(
          dir,
          ClaudeMcpServers.ClaudeMcpServers.use((servers) =>
            servers.setAccountConnectors({ instanceId: CLAUDE, enabled }),
          ),
        ).pipe(Effect.provide(serviceLayer({ instances: claudeHome(dir) })));
      const read = fs.readFileString(settingsPath).pipe(Effect.map((text) => JSON.parse(text)));

      expect((yield* set(false)).accountConnectorsEnabled).toBe(false);
      expect(yield* read).toEqual({ disableClaudeAiConnectors: true });
      expect(((yield* fs.stat(settingsPath)).mode & 0o777).toString(8)).toBe("600");

      yield* writeJson(settingsPath, { model: "opus", disableClaudeAiConnectors: true });
      expect((yield* set(true)).accountConnectorsEnabled).toBe(true);
      expect(yield* read).toEqual({ model: "opus" });

      yield* writeJson(settingsPath, "{broken");
      expect(yield* failureReason(set(false))).toBe("ConfigUnreadable");
      expect(yield* fs.readFileString(settingsPath)).toBe("{broken");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});

describe("ClaudeMcpServers sign-in", () => {
  const AUTH_URL = "https://mcp.example.com/authorize?client_id=abc&state=xyz";

  const setup = Effect.gen(function* () {
    const path = yield* Path.Path;
    const dir = yield* tempHome;
    yield* writeJson(path.join(dir, ".claude.json"), FIXTURE);
    const { adapter, spawned } = yield* makePtyAdapter;
    return { dir, spawned, layer: serviceLayer({ instances: claudeHome(dir), pty: adapter }) };
  });

  const offerUrl = (fake: FakePty) => {
    fake.emit("Starting authentication…\r\n\u001b[1mVisit this URL to authorize:\u001b[22m\r\n  ");
    fake.emit(AUTH_URL.slice(0, 30));
    fake.emit(`${AUTH_URL.slice(30)}\r\n\r\nOr paste the redirect URL here: `);
  };

  it.effect("parses the URL from split ANSI output and completes with the pasted address", () =>
    Effect.gen(function* () {
      const { dir, spawned, layer } = yield* setup;
      yield* withHost(
        dir,
        ClaudeMcpServers.ClaudeMcpServers.use((servers) =>
          Effect.gen(function* () {
            const starting = yield* Effect.forkChild(
              servers.signInStart({ instanceId: CLAUDE, name: "web" }),
            );
            const fake = yield* Queue.take(spawned);
            expect(fake.input.args).toEqual(["mcp", "login", "web", "--no-browser"]);
            expect(fake.input.cols).toBe(200);
            expect(fake.input.env.CLAUDE_CONFIG_DIR).toBe(dir);
            offerUrl(fake);
            const started = yield* Fiber.join(starting);
            expect(started.authorizationUrl).toBe(AUTH_URL);

            fake.onWrite = () => fake.exit(0);
            const completed = yield* servers.signInComplete({
              signInId: started.signInId,
              callbackUrl: "http://localhost:5000/callback?code=c&state=xyz",
            });
            expect(fake.writes).toEqual(["http://localhost:5000/callback?code=c&state=xyz\r"]);
            expect(completed.signedInAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            expect(
              yield* failureReason(
                servers.signInComplete({ signInId: started.signInId, callbackUrl: "http://x" }),
              ),
            ).toBe("SignInExpired");
          }),
        ),
      ).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("succeeds without a paste when the CLI already finished on its own", () =>
    Effect.gen(function* () {
      const { dir, spawned, layer } = yield* setup;
      yield* withHost(
        dir,
        ClaudeMcpServers.ClaudeMcpServers.use((servers) =>
          Effect.gen(function* () {
            const starting = yield* Effect.forkChild(
              servers.signInStart({ instanceId: CLAUDE, name: "web" }),
            );
            const fake = yield* Queue.take(spawned);
            offerUrl(fake);
            const started = yield* Fiber.join(starting);
            fake.exit(0);
            yield* servers.signInComplete({ signInId: started.signInId, callbackUrl: "http://x" });
            expect(fake.writes).toEqual([]);
          }),
        ),
      ).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("fails when the CLI exits non-zero or before offering a URL", () =>
    Effect.gen(function* () {
      const { dir, spawned, layer } = yield* setup;
      yield* withHost(
        dir,
        ClaudeMcpServers.ClaudeMcpServers.use((servers) =>
          Effect.gen(function* () {
            const starting = yield* Effect.forkChild(
              servers.signInStart({ instanceId: CLAUDE, name: "web" }),
            );
            const fake = yield* Queue.take(spawned);
            offerUrl(fake);
            const started = yield* Fiber.join(starting);
            fake.onWrite = () => fake.exit(1);
            expect(
              yield* failureReason(
                servers.signInComplete({ signInId: started.signInId, callbackUrl: "http://x" }),
              ),
            ).toBe("SignInFailed");

            const early = yield* Effect.forkChild(
              failureReason(servers.signInStart({ instanceId: CLAUDE, name: "web" })),
            );
            (yield* Queue.take(spawned)).exit(1);
            expect(yield* Fiber.join(early)).toBe("SignInFailed");
          }),
        ),
      ).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("expires a sign-in after ten minutes and kills its terminal", () =>
    Effect.gen(function* () {
      const { dir, spawned, layer } = yield* setup;
      yield* withHost(
        dir,
        ClaudeMcpServers.ClaudeMcpServers.use((servers) =>
          Effect.gen(function* () {
            const starting = yield* Effect.forkChild(
              servers.signInStart({ instanceId: CLAUDE, name: "web" }),
            );
            const fake = yield* Queue.take(spawned);
            offerUrl(fake);
            const started = yield* Fiber.join(starting);
            yield* TestClock.adjust("11 minutes");
            expect(fake.killed).toBe(true);
            expect(
              yield* failureReason(
                servers.signInComplete({ signInId: started.signInId, callbackUrl: "http://x" }),
              ),
            ).toBe("SignInExpired");
          }),
        ),
      ).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("a second start for the same connector cancels the first", () =>
    Effect.gen(function* () {
      const { dir, spawned, layer } = yield* setup;
      yield* withHost(
        dir,
        ClaudeMcpServers.ClaudeMcpServers.use((servers) =>
          Effect.gen(function* () {
            const start = Effect.gen(function* () {
              const starting = yield* Effect.forkChild(
                servers.signInStart({ instanceId: CLAUDE, name: "web" }),
              );
              const fake = yield* Queue.take(spawned);
              offerUrl(fake);
              return { fake, started: yield* Fiber.join(starting) };
            });
            const first = yield* start;
            const second = yield* start;
            expect(first.fake.killed).toBe(true);
            expect(second.fake.killed).toBe(false);
            expect(
              yield* failureReason(
                servers.signInComplete({
                  signInId: first.started.signInId,
                  callbackUrl: "http://x",
                }),
              ),
            ).toBe("SignInExpired");
          }),
        ),
      ).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("kills pending terminals when the service shuts down", () =>
    Effect.gen(function* () {
      const { dir, spawned, layer } = yield* setup;
      const fake = yield* withHost(
        dir,
        ClaudeMcpServers.ClaudeMcpServers.use((servers) =>
          Effect.gen(function* () {
            const starting = yield* Effect.forkChild(
              servers.signInStart({ instanceId: CLAUDE, name: "web" }),
            );
            const fake = yield* Queue.take(spawned);
            offerUrl(fake);
            yield* Fiber.join(starting);
            expect(fake.killed).toBe(false);
            return fake;
          }),
        ),
      ).pipe(Effect.provide(layer));
      expect(fake.killed).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("needs a terminal adapter", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const dir = yield* tempHome;
      yield* writeJson(path.join(dir, ".claude.json"), FIXTURE);
      const error = yield* withHost(
        dir,
        ClaudeMcpServers.ClaudeMcpServers.use((servers) =>
          servers.signInStart({ instanceId: CLAUDE, name: "web" }),
        ),
      ).pipe(Effect.provide(serviceLayer({ instances: claudeHome(dir) })), Effect.flip);
      expect(error.reason).toBe("SignInFailed");
      expect(error.detail).toContain("Sign in from a thread");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
