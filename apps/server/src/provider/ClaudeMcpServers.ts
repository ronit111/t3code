/**
 * A Claude instance's user-scope MCP servers ("connectors"), managed from Settings. Writes go
 * through the `claude mcp` CLI, which owns and often rewrites the account config file; listing
 * reads that file, because `claude mcp list` health-checks and spawns every stdio server.
 */
import {
  ClaudeConnectorsError,
  ClaudeSettings,
  ProviderDriverKind,
  SignInUrl,
  defaultInstanceIdForDriver,
  type ClaudeConnectorDefinition,
  type ClaudeConnectorSummary,
  type ClaudeConnectorsAddInput,
  type ClaudeConnectorsNamedInput,
  type ClaudeConnectorsSetAccountConnectorsInput,
  type ClaudeConnectorsSignInCompleteInput,
  type ClaudeConnectorsSignInCompleteResult,
  type ClaudeConnectorsSignInStartResult,
  type ClaudeConnectorsState,
  type ProviderInstanceId,
} from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as PtyAdapter from "@t3tools/shared/PtyAdapter";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as Settings from "../serverSettings.ts";
import { claudeAccountConfigPath } from "./claudeResetCredits.ts";
import {
  makeClaudeEnvironment,
  mergeClaudeProcessEnvironment,
  resolveClaudeHomePath,
} from "./Drivers/ClaudeHome.ts";

type NamedInput = ClaudeConnectorsNamedInput;
type Reason = ClaudeConnectorsError["reason"];

export class ClaudeMcpServers extends Context.Service<
  ClaudeMcpServers,
  {
    readonly list: (input: {
      readonly instanceId: ProviderInstanceId;
    }) => Effect.Effect<ClaudeConnectorsState, ClaudeConnectorsError>;
    readonly add: (
      input: ClaudeConnectorsAddInput,
    ) => Effect.Effect<ClaudeConnectorsState, ClaudeConnectorsError>;
    readonly remove: (
      input: NamedInput,
    ) => Effect.Effect<ClaudeConnectorsState, ClaudeConnectorsError>;
    /** Applies to sessions started afterwards; running sessions keep what they loaded. */
    readonly setAccountConnectors: (
      input: ClaudeConnectorsSetAccountConnectorsInput,
    ) => Effect.Effect<ClaudeConnectorsState, ClaudeConnectorsError>;
    readonly signInStart: (
      input: NamedInput,
    ) => Effect.Effect<ClaudeConnectorsSignInStartResult, ClaudeConnectorsError>;
    readonly signInComplete: (
      input: ClaudeConnectorsSignInCompleteInput,
    ) => Effect.Effect<ClaudeConnectorsSignInCompleteResult, ClaudeConnectorsError>;
    readonly signInCancel: (input: { readonly signInId: string }) => Effect.Effect<void>;
    readonly signOut: (
      input: NamedInput,
    ) => Effect.Effect<ClaudeConnectorsState, ClaudeConnectorsError>;
  }
>()("t3/provider/ClaudeMcpServers") {}

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
const CLI_TIMEOUT = "30 seconds";
const SIGN_IN_URL_TIMEOUT = "30 seconds";
const SIGN_IN_COMPLETE_TIMEOUT = "60 seconds";
const SIGN_IN_LIFETIME_MS = 10 * 60 * 1000;
const MAX_SIGN_IN_OUTPUT = 64 * 1024;

const ANSI_PATTERN =
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;
// The URL counts only once whitespace follows it, so a chunk boundary cannot cut it short.
const AUTHORIZATION_URL = /https:\/\/\S+(?=\s)/;

const decodeClaudeSettings = Schema.decodeUnknownEffect(ClaudeSettings);
const decodeSignInUrl = Schema.decodeUnknownOption(SignInUrl);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const formatSettings = (value: Record<string, unknown>) => `${JSON.stringify(value, null, 2)}\n`;

const fail = (reason: Reason, detail: string) => new ClaudeConnectorsError({ reason, detail });

const DETAILS = {
  instanceNotFound: "This Claude provider no longer exists.",
  notClaude: "Connectors are only available for Claude providers.",
  nameTaken: "A connector with this name already exists. Remove it first to change it.",
  notFound: "This connector no longer exists.",
  cliMissing: "Claude Code could not be started. Check the provider's binary path.",
  cliFailed: "Claude Code could not change this connector.",
  configUnreadable: "Claude Code's config file could not be read.",
  settingsUnreadable: "Claude Code's settings.json could not be read, so nothing was changed.",
  signInExpired: "This sign-in has expired. Start it again.",
  signInFailed: "The sign-in did not finish. Start it again.",
  signInNoUrl: "Claude Code did not offer a sign-in page for this connector.",
  signInUnavailable:
    "Sign-in isn't available on this server. Sign in from a thread that uses this connector.",
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const KNOWN_TRANSPORTS = new Set(["stdio", "http", "sse", "ws"]);

const summarize = (name: string, entry: unknown): ClaudeConnectorSummary => {
  const record = isRecord(entry) ? entry : {};
  const declared = typeof record.type === "string" ? record.type : undefined;
  const transport = (
    declared === undefined
      ? typeof record.command === "string"
        ? "stdio"
        : "unknown"
      : KNOWN_TRANSPORTS.has(declared)
        ? declared
        : "unknown"
  ) as ClaudeConnectorSummary["transport"];
  const args = Array.isArray(record.args)
    ? record.args.filter((arg): arg is string => typeof arg === "string")
    : [];
  const target =
    typeof record.url === "string"
      ? record.url
      : typeof record.command === "string"
        ? [record.command, ...args].join(" ")
        : "";
  const secretNames = [
    ...new Set([
      ...(isRecord(record.env) ? Object.keys(record.env) : []),
      ...(isRecord(record.headers) ? Object.keys(record.headers) : []),
    ]),
  ];
  return {
    name,
    transport,
    target,
    secretNames,
    canSignIn: transport === "http" || transport === "sse",
  };
};

const toClaudeJson = (definition: ClaudeConnectorDefinition) => {
  const entries = (pairs: ReadonlyArray<{ readonly name: string; readonly value: string }>) =>
    Object.fromEntries(pairs.map(({ name, value }) => [name, value]));
  return definition.transport === "stdio"
    ? {
        type: "stdio",
        command: definition.command,
        args: definition.args,
        env: entries(definition.env),
      }
    : { type: definition.transport, url: definition.url, headers: entries(definition.headers) };
};

interface ResolvedInstance {
  readonly instanceId: ProviderInstanceId;
  readonly binary: string;
  readonly env: NodeJS.ProcessEnv;
  readonly configDir: string;
  readonly accountConfigPath: string;
}

interface PendingSignIn {
  readonly instanceId: ProviderInstanceId;
  readonly name: string;
  readonly pty: PtyAdapter.PtyProcess;
  readonly exited: Deferred.Deferred<number>;
  readonly expiresAt: number;
  readonly detach: () => void;
}

const make = Effect.gen(function* () {
  const settings = yield* Settings.ServerSettingsService;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const runner = yield* ProcessRunner.make();
  const pty = yield* Effect.serviceOption(PtyAdapter.PtyAdapter);
  const layerScope = yield* Effect.scope;
  // Each write is a read-check-run sequence against one file; one at a time keeps checks true.
  const writeLock = yield* Semaphore.make(1);
  const pending = new Map<string, PendingSignIn>();
  const withPlatform = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );

  const resolve = Effect.fn("ClaudeMcpServers.resolve")(function* (instanceId: ProviderInstanceId) {
    const current = yield* settings.getSettings.pipe(
      Effect.mapError(() => fail("ConfigUnreadable", DETAILS.configUnreadable)),
    );
    const entry =
      current.providerInstances[instanceId] ??
      (instanceId === defaultInstanceIdForDriver(CLAUDE_DRIVER)
        ? { driver: CLAUDE_DRIVER }
        : undefined);
    if (entry === undefined) return yield* fail("InstanceNotFound", DETAILS.instanceNotFound);
    if (entry.driver !== CLAUDE_DRIVER) return yield* fail("NotClaudeInstance", DETAILS.notClaude);
    const config = yield* decodeClaudeSettings(entry.config ?? {}).pipe(
      Effect.mapError(() => fail("ConfigUnreadable", DETAILS.configUnreadable)),
    );
    // Only literal variables: `claude mcp` needs the config directory, not secret-backed keys.
    const processEnv = yield* mergeClaudeProcessEnvironment(
      config,
      entry.environment,
      yield* HostProcess.Environment,
    );
    const env = yield* makeClaudeEnvironment(config, processEnv);
    const configDir = yield* resolveClaudeHomePath(config, env);
    const customHome = config.homePath.trim().length > 0 || Boolean(env.CLAUDE_CONFIG_DIR?.trim());
    return {
      instanceId,
      binary: expandHomePath(config.binaryPath, yield* HostProcess.HomeDirectory),
      env,
      configDir,
      accountConfigPath: yield* claudeAccountConfigPath(customHome ? configDir : undefined),
    } satisfies ResolvedInstance;
  }, withPlatform);

  const readJsonFile = Effect.fn("ClaudeMcpServers.readJsonFile")(function* (
    filePath: string,
    detail: string,
  ) {
    const unreadable = () => fail("ConfigUnreadable", detail);
    const text = yield* fileSystem.readFileString(filePath).pipe(
      Effect.asSome,
      Effect.catchReason("PlatformError", "NotFound", () => Effect.succeedNone),
      Effect.mapError(unreadable),
    );
    if (Option.isNone(text)) return Option.none<unknown>();
    return Option.some(yield* decodeJson(text.value).pipe(Effect.mapError(unreadable)));
  });

  const readServers = Effect.fn("ClaudeMcpServers.readServers")(function* (
    instance: ResolvedInstance,
  ) {
    const config = yield* readJsonFile(instance.accountConfigPath, DETAILS.configUnreadable);
    const servers = Option.isSome(config) && isRecord(config.value) ? config.value.mcpServers : {};
    return isRecord(servers) ? servers : {};
  });

  const readState = Effect.fn("ClaudeMcpServers.readState")(function* (instance: ResolvedInstance) {
    const servers = yield* readServers(instance);
    const userSettings = yield* readJsonFile(
      path.join(instance.configDir, "settings.json"),
      DETAILS.configUnreadable,
    );
    const disabled =
      Option.isSome(userSettings) &&
      isRecord(userSettings.value) &&
      userSettings.value.disableClaudeAiConnectors === true;
    return {
      instanceId: instance.instanceId,
      configDir: instance.configDir,
      servers: Object.entries(servers).map(([name, entry]) => summarize(name, entry)),
      accountConnectorsEnabled: !disabled,
    } satisfies ClaudeConnectorsState;
  });

  const requireServer = Effect.fn("ClaudeMcpServers.requireServer")(function* (
    instance: ResolvedInstance,
    name: string,
  ) {
    const servers = yield* readServers(instance);
    if (!Object.hasOwn(servers, name)) return yield* fail("NotFound", DETAILS.notFound);
    return summarize(name, servers[name]);
  });

  const runCli = Effect.fn("ClaudeMcpServers.runCli")(function* (
    instance: ResolvedInstance,
    args: ReadonlyArray<string>,
    stdin?: string,
  ) {
    const result = yield* runner
      .run({
        command: instance.binary,
        args,
        stdin,
        cwd: stateDir,
        env: instance.env,
        timeout: CLI_TIMEOUT,
        maxOutputBytes: 64 * 1024,
        outputMode: "truncate",
      })
      .pipe(
        Effect.mapError((error) =>
          error._tag === "ProcessSpawnError"
            ? fail("CliMissing", DETAILS.cliMissing)
            : fail("CliFailed", DETAILS.cliFailed),
        ),
      );
    if (result.code !== 0) {
      // stdin carries connector secrets; the CLI could echo them back on a parse error.
      yield* Effect.logWarning("claude mcp exited with an error", {
        args: args.slice(0, 2),
        code: result.code,
        stderr: stdin === undefined ? result.stderr.slice(-2000) : "(omitted: input had secrets)",
      });
      return yield* fail("CliFailed", DETAILS.cliFailed);
    }
  });

  const list = Effect.fn("ClaudeMcpServers.list")(function* (input: {
    readonly instanceId: ProviderInstanceId;
  }) {
    return yield* readState(yield* resolve(input.instanceId));
  });

  const add = Effect.fn("ClaudeMcpServers.add")(function* (input: ClaudeConnectorsAddInput) {
    const instance = yield* resolve(input.instanceId);
    const servers = yield* readServers(instance);
    if (Object.hasOwn(servers, input.name)) return yield* fail("NameTaken", DETAILS.nameTaken);
    // `-` reads the JSON from stdin, keeping env and header secrets out of argv, which `ps` shows.
    yield* runCli(
      instance,
      ["mcp", "add-json", input.name, "-", "--scope", "user"],
      encodeJson(toClaudeJson(input.definition)),
    );
    return yield* readState(instance);
  }, writeLock.withPermits(1));

  const remove = Effect.fn("ClaudeMcpServers.remove")(function* (input: NamedInput) {
    const instance = yield* resolve(input.instanceId);
    yield* requireServer(instance, input.name);
    yield* runCli(instance, ["mcp", "remove", input.name, "--scope", "user"]);
    return yield* readState(instance);
  }, writeLock.withPermits(1));

  const setAccountConnectors = Effect.fn("ClaudeMcpServers.setAccountConnectors")(function* (
    input: ClaudeConnectorsSetAccountConnectorsInput,
  ) {
    const instance = yield* resolve(input.instanceId);
    const settingsPath = path.join(instance.configDir, "settings.json");
    const existing = yield* readJsonFile(settingsPath, DETAILS.settingsUnreadable);
    if (Option.isSome(existing) && !isRecord(existing.value)) {
      return yield* fail("ConfigUnreadable", DETAILS.settingsUnreadable);
    }
    const next: Record<string, unknown> = Option.isSome(existing)
      ? { ...(existing.value as Record<string, unknown>) }
      : {};
    if (input.enabled) delete next.disableClaudeAiConnectors;
    else next.disableClaudeAiConnectors = true;
    yield* writeFileStringAtomically({
      filePath: settingsPath,
      contents: formatSettings(next),
    }).pipe(
      withPlatform,
      Effect.mapError(() => fail("ConfigUnreadable", DETAILS.settingsUnreadable)),
    );
    return yield* readState(instance);
  }, writeLock.withPermits(1));

  const signOut = Effect.fn("ClaudeMcpServers.signOut")(function* (input: NamedInput) {
    const instance = yield* resolve(input.instanceId);
    yield* requireServer(instance, input.name);
    yield* runCli(instance, ["mcp", "logout", input.name]);
    return yield* readState(instance);
  });

  const discard = (signInId: string) =>
    Effect.sync(() => {
      const session = pending.get(signInId);
      if (session === undefined) return;
      pending.delete(signInId);
      session.detach();
      try {
        session.pty.kill();
      } catch {}
    });

  yield* Effect.addFinalizer(() => Effect.forEach([...pending.keys()], discard, { discard: true }));

  const signInStart = Effect.fn("ClaudeMcpServers.signInStart")(function* (input: NamedInput) {
    if (Option.isNone(pty)) return yield* fail("SignInFailed", DETAILS.signInUnavailable);
    const instance = yield* resolve(input.instanceId);
    yield* requireServer(instance, input.name);
    for (const [signInId, session] of pending) {
      if (session.instanceId === input.instanceId && session.name === input.name) {
        yield* discard(signInId);
      }
    }
    const process = yield* pty.value
      .spawn({
        shell: instance.binary,
        args: ["mcp", "login", input.name, "--no-browser"],
        cwd: stateDir,
        cols: 200,
        rows: 24,
        env: instance.env,
      })
      .pipe(Effect.mapError(() => fail("CliMissing", DETAILS.cliMissing)));
    const exited = yield* Deferred.make<number>();
    const offered = yield* Deferred.make<Option.Option<string>>();
    // PTY output echoes the pasted callback URL, so it never leaves this closure.
    let output = "";
    const detachData = process.onData((data) => {
      output = (output + data).slice(-MAX_SIGN_IN_OUTPUT);
      const match = AUTHORIZATION_URL.exec(output.replace(ANSI_PATTERN, ""));
      if (match !== null) Deferred.doneUnsafe(offered, Exit.succeed(Option.some(match[0])));
    });
    const detachExit = process.onExit(({ exitCode }) => {
      Deferred.doneUnsafe(exited, Exit.succeed(exitCode));
      Deferred.doneUnsafe(offered, Exit.succeed(Option.none()));
    });
    const detach = () => {
      detachData();
      detachExit();
    };
    const killNow = Effect.sync(() => {
      detach();
      try {
        process.kill();
      } catch {}
    });
    const url = yield* Deferred.await(offered).pipe(
      Effect.timeoutOption(SIGN_IN_URL_TIMEOUT),
      Effect.map((found) => Option.flatMap(Option.flatten(found), decodeSignInUrl)),
      Effect.onInterrupt(() => killNow),
    );
    if (Option.isNone(url)) {
      yield* killNow;
      return yield* fail("SignInFailed", DETAILS.signInNoUrl);
    }
    const signInId = yield* random.uuidV4();
    pending.set(signInId, {
      instanceId: input.instanceId,
      name: input.name,
      pty: process,
      exited,
      expiresAt: (yield* Clock.currentTimeMillis) + SIGN_IN_LIFETIME_MS,
      detach,
    });
    yield* Effect.sleep(SIGN_IN_LIFETIME_MS).pipe(
      Effect.andThen(
        Effect.suspend(() =>
          pending.get(signInId)?.pty === process ? discard(signInId) : Effect.void,
        ),
      ),
      Effect.forkIn(layerScope),
    );
    return { signInId, authorizationUrl: url.value } satisfies ClaudeConnectorsSignInStartResult;
  });

  const signInComplete = Effect.fn("ClaudeMcpServers.signInComplete")(function* (
    input: ClaudeConnectorsSignInCompleteInput,
  ) {
    const session = pending.get(input.signInId);
    if (session === undefined || (yield* Clock.currentTimeMillis) >= session.expiresAt) {
      yield* discard(input.signInId);
      return yield* fail("SignInExpired", DETAILS.signInExpired);
    }
    // A local browser can reach the CLI's own callback listener and finish before any paste.
    const done = yield* Deferred.poll(session.exited);
    if (Option.isNone(done)) {
      const written = yield* Effect.try({
        try: () => session.pty.write(`${input.callbackUrl}\r`),
        catch: () => fail("SignInFailed", DETAILS.signInFailed),
      }).pipe(Effect.exit);
      if (Exit.isFailure(written)) {
        yield* discard(input.signInId);
        return yield* fail("SignInFailed", DETAILS.signInFailed);
      }
    }
    // A wrong address makes the CLI ask again instead of exiting; the timeout ends that wait.
    const exitCode = yield* Deferred.await(session.exited).pipe(
      Effect.timeoutOption(SIGN_IN_COMPLETE_TIMEOUT),
    );
    if (Option.isNone(exitCode)) return yield* fail("SignInFailed", DETAILS.signInFailed);
    yield* discard(input.signInId);
    if (exitCode.value !== 0) return yield* fail("SignInFailed", DETAILS.signInFailed);
    return { signedInAt: DateTime.formatIso(yield* DateTime.now) };
  });

  const signInCancel = Effect.fn("ClaudeMcpServers.signInCancel")(function* (input: {
    readonly signInId: string;
  }) {
    yield* discard(input.signInId);
  });

  return ClaudeMcpServers.of({
    list,
    add,
    remove,
    setAccountConnectors,
    signInStart,
    signInComplete,
    signInCancel,
    signOut,
  });
});

export const layer = Layer.effect(ClaudeMcpServers, make);
