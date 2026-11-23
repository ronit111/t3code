import * as NodeServices from "@effect/platform-node/NodeServices";
import { ClaudeSettings, ServerSettings } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import type { ProfileEntry } from "./ProfileRegistry.ts";
import { seedProfileHome } from "./ProfileSeed.ts";

const ID = "pa1b2c3d4e5";
const entry = {
  id: ID,
  name: "Work",
  createdAt: "2026-11-23T10:00:00.000Z",
  lock: null,
} as ProfileEntry;

const decodeServerSettings = Schema.decodeUnknownEffect(ServerSettings);
const decodeClaudeSettings = Schema.decodeUnknownEffect(ClaudeSettings);

const withRoot = <A, E>(
  run: (root: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.realPath(
      yield* fs.makeTempDirectoryScoped({ prefix: "t3-profiles-seed-" }),
    );
    return yield* run(path.join(directory, "root"));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("seedProfileHome", () => {
  it.effect("points the Claude and Codex instances at the profile's own folders", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* seedProfileHome(root, entry);
        const home = `${root}/${ID}`;

        const raw = JSON.parse(yield* fs.readFileString(`${home}/userdata/settings.json`));
        const settings = yield* decodeServerSettings(raw);
        assert.deepEqual(Object.keys(raw.providerInstances).sort(), ["claudeAgent", "codex"]);
        const claude =
          settings.providerInstances["claudeAgent" as keyof typeof settings.providerInstances];
        const codex =
          settings.providerInstances["codex" as keyof typeof settings.providerInstances];
        assert.equal(claude?.driver, "claudeAgent");
        assert.equal(codex?.driver, "codex");
        const claudeConfig = yield* decodeClaudeSettings(claude?.config);
        assert.equal(claudeConfig.homePath, `${home}/providers/claude`);
        assert.deepEqual(codex?.config, { homePath: `${home}/providers/codex` });

        assert.equal(
          yield* fs.readFileString(`${home}/providers/claude/settings.json`),
          '{\n  "disableClaudeAiConnectors": true\n}\n',
        );
        assert.deepEqual(JSON.parse(yield* fs.readFileString(`${home}/profile.json`)), entry);
        assert.isTrue(yield* fs.exists(`${home}/providers/codex`));
        assert.equal((yield* fs.stat(home)).mode & 0o777, 0o700);
      }),
    ),
  );

  it.effect("fails with Io when the folder already exists", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(`${root}/${ID}`, { recursive: true });
        const error = yield* Effect.flip(seedProfileHome(root, entry));
        assert.equal(error.reason, "Io");
        assert.isFalse(yield* fs.exists(`${root}/${ID}/userdata`));
      }),
    ),
  );
});
