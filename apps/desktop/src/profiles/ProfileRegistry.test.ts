import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import {
  adoptOrphanProfiles,
  decodeRegistryText,
  encodeRegistryText,
  readRegistry,
  writeProfileMirror,
  writeRegistry,
  type ProfileEntry,
  type ProfileRegistry,
} from "./ProfileRegistry.ts";

const P1 = "pa1b2c3d4e5";
const P2 = "pf6g7h8i9j0";
const LOCK = {
  kdf: "scrypt",
  N: 1024,
  r: 8,
  p: 1,
  keyLength: 64,
  salt: "c2FsdA==",
  hash: "aGFzaA==",
} as const;

const entry = (id: string, name: string | null, lock: ProfileEntry["lock"] = null) =>
  ({ id, name, createdAt: "2026-11-23T10:00:00.000Z", lock }) as ProfileEntry;

const text = (profiles: ReadonlyArray<unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, profiles, ...extra });

const decoded = (value: string): ProfileRegistry => {
  const registry = decodeRegistryText(value);
  assert.isTrue(Option.isSome(registry), value);
  return Option.getOrThrow(registry);
};

const withRoot = <A, E>(
  run: (root: string) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-profiles-registry-" });
    return yield* run(path.join(directory, "profiles-root"));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("ProfileRegistry decoding", () => {
  it("round-trips a registry and drops unknown keys", () => {
    const registry = decoded(
      text([{ ...entry("default", null), extra: true }, entry(P1, "Work", LOCK)], {
        lastUsedProfileId: P1,
        future: "key",
      }),
    );
    assert.deepEqual(decoded(encodeRegistryText(registry)), registry);
    assert.deepEqual(JSON.parse(encodeRegistryText(registry)), {
      version: 1,
      profiles: [entry("default", null), entry(P1, "Work", LOCK)],
      lastUsedProfileId: P1,
    });
  });

  it("synthesizes a missing Default first", () => {
    const registry = decoded(text([entry(P1, "Work")]));
    assert.deepEqual(
      registry.profiles.map((profile) => [profile.id, profile.name, profile.lock]),
      [
        ["default", null, null],
        [P1, "Work", null],
      ],
    );
  });

  it.each([
    { name: "duplicate names ignoring case", profiles: [entry(P1, "Work"), entry(P2, "WORK")] },
    { name: "a null name on another profile", profiles: [entry(P1, null)] },
    { name: "two Default entries", profiles: [entry("default", null), entry("default", "Me")] },
    { name: "duplicate ids", profiles: [entry(P1, "Work"), entry(P1, "Travel")] },
    { name: "an untrimmed name", profiles: [entry(P1, " Work")] },
    { name: "a name over 40 characters", profiles: [entry(P1, "a".repeat(41))] },
    { name: "an invalid id", profiles: [entry("p123", "Work")] },
    { name: "an invalid date", profiles: [{ ...entry(P1, "Work"), createdAt: "yesterday" }] },
  ])("rejects $name", ({ profiles }) => {
    assert.isTrue(Option.isNone(decodeRegistryText(text(profiles))));
  });

  it("rejects another version and invalid JSON", () => {
    assert.isTrue(Option.isNone(decodeRegistryText(JSON.stringify({ version: 2, profiles: [] }))));
    assert.isTrue(Option.isNone(decodeRegistryText("{not json")));
  });
});

describe("ProfileRegistry files", () => {
  it.effect("writes atomically with private modes and reads back", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        assert.isTrue(Option.isNone(yield* readRegistry(root)));
        const registry = decoded(text([entry("default", null), entry(P1, "Work")]));
        yield* writeRegistry(root, registry);
        assert.deepEqual(yield* readRegistry(root), Option.some(registry));
        assert.deepEqual(yield* fs.readDirectory(root), ["profiles.json"]);
        assert.equal((yield* fs.stat(root)).mode & 0o777, 0o700);
        assert.equal((yield* fs.stat(`${root}/profiles.json`)).mode & 0o777, 0o600);
      }),
    ),
  );

  it.effect("fails with RegistryUnreadable for a corrupt file", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* fs.makeDirectory(root, { recursive: true });
        yield* fs.writeFileString(`${root}/profiles.json`, "{not json");
        const error = yield* Effect.flip(readRegistry(root));
        assert.equal(error.reason, "RegistryUnreadable");
      }),
    ),
  );

  it.effect("adopts an orphan with a valid profile.json, with its lock, and ignores the rest", () =>
    withRoot((root) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const registry = decoded(text([entry("default", null), entry(P2, "Work")]));
        yield* writeProfileMirror(root, entry(P1, "Work", LOCK));
        yield* fs.makeDirectory(`${root}/pzzzzzzzzzz/userdata`, { recursive: true });
        yield* fs.makeDirectory(`${root}/pyyyyyyyyyy`, { recursive: true });
        yield* fs.writeFileString(`${root}/pyyyyyyyyyy/profile.json`, "{broken");
        yield* fs.makeDirectory(`${root}/pxxxxxxxxxx`, { recursive: true });
        yield* fs.writeFileString(
          `${root}/pxxxxxxxxxx/profile.json`,
          JSON.stringify(entry(P2, "Names another folder")),
        );

        const { registry: next, adopted } = yield* adoptOrphanProfiles(root, registry);

        assert.deepEqual(adopted, [entry(P1, "Work (restored)", LOCK)]);
        assert.deepEqual(
          next.profiles.map((profile) => profile.id),
          ["default", P2, P1],
        );
      }),
    ),
  );
});
