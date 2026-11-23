// @effect-diagnostics globalDate:off - ProfileServiceLiveInput.now returns a plain Date.
import * as NodeSqlite from "node:sqlite";

import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as DesktopPreReadyFileSystem from "../app/DesktopPreReadyFileSystem.ts";
import { ProfileService, type ProfileId } from "./ProfileContract.ts";
import { PRODUCTION_SCRYPT_PARAMETERS, ProfileScryptParameters } from "./ProfileLock.ts";
import * as ProfileServiceLive from "./ProfileServiceLive.ts";

const NOW = new Date("2026-11-23T10:05:00.000Z");

interface Harness {
  readonly root: string;
  readonly appData: string;
  readonly trashDir: string;
  readonly trashed: Array<string>;
  readonly relaunches: { count: number };
}

const makeHarness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.realPath(
    yield* fs.makeTempDirectoryScoped({ prefix: "t3-profiles-service-" }),
  );
  const harness: Harness = {
    root: path.join(directory, "profiles"),
    appData: path.join(directory, "appData"),
    trashDir: path.join(directory, "Trash"),
    trashed: [],
    relaunches: { count: 0 },
  };
  yield* fs.makeDirectory(harness.trashDir, { recursive: true });
  return harness;
});

const serviceLayer = (harness: Harness) =>
  ProfileServiceLive.layer({
    profilesRoot: harness.root,
    defaultHome: "/unused/.t3",
    appDataDirectory: harness.appData,
    isDevelopment: false,
    now: () => NOW,
    trashItem: (target) => {
      harness.trashed.push(target);
      return Promise.resolve();
    },
    relaunch: () => {
      harness.relaunches.count += 1;
    },
  });

const withService = <A, E>(
  run: (
    service: ProfileService["Service"],
    harness: Harness,
  ) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const harness = yield* makeHarness;
    const service = yield* ProfileService.pipe(Effect.provide(serviceLayer(harness)));
    return yield* run(service, harness);
  }).pipe(
    Effect.provideService(ProfileScryptParameters, { ...PRODUCTION_SCRYPT_PARAMETERS, N: 1024 }),
    Effect.scoped,
    Effect.provide(NodeServices.layer),
  );

const readJson = (filePath: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.readFileString(filePath)).pipe(
    Effect.map((text) => JSON.parse(text) as Record<string, unknown>),
  );

const reasonOf = <A, R>(effect: Effect.Effect<A, { readonly reason: string }, R>) =>
  Effect.flip(effect).pipe(Effect.map((error) => error.reason));

describe("ProfileServiceLive", () => {
  it.effect("creates a seeded profile and lists Default first", () =>
    withService((service, harness) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const created = yield* service.create({ name: "  Work ", password: null });
        assert.match(created.id, /^p[0-9a-z]{10}$/);
        assert.deepEqual(created, {
          id: created.id,
          name: "Work",
          isDefault: false,
          locked: false,
          lastUsed: false,
        });
        assert.isTrue(yield* fs.exists(`${harness.root}/${created.id}/userdata/settings.json`));
        assert.deepEqual(
          (yield* service.list).map((profile) => [profile.id, profile.name]),
          [
            ["default", null],
            [created.id, "Work"],
          ],
        );
        assert.deepEqual(
          (
            (yield* readJson(`${harness.root}/profiles.json`)).profiles as Array<{ id: string }>
          ).map((profile) => profile.id),
          ["default", created.id],
        );
      }),
    ),
  );

  it.effect("validates names and passwords", () =>
    withService((service) =>
      Effect.gen(function* () {
        yield* service.create({ name: "Work", password: null });
        assert.equal(
          yield* reasonOf(service.create({ name: "  ", password: null })),
          "InvalidName",
        );
        assert.equal(
          yield* reasonOf(service.create({ name: "a".repeat(41), password: null })),
          "InvalidName",
        );
        assert.equal(
          yield* reasonOf(service.create({ name: "WORK", password: null })),
          "DuplicateName",
        );
        assert.equal(
          yield* reasonOf(service.create({ name: "Travel", password: "abc" })),
          "InvalidPassword",
        );
      }),
    ),
  );

  it.effect("renames and sets, changes and removes a password", () =>
    withService((service, harness) =>
      Effect.gen(function* () {
        const profile = yield* service.create({ name: "Work", password: "first" });
        assert.isTrue(profile.locked);
        const id = profile.id;
        assert.equal(
          yield* reasonOf(service.rename({ id, name: "Office", password: null })),
          "PasswordRequired",
        );
        const renamed = yield* service.rename({ id, name: "Office", password: "first" });
        assert.equal(renamed.name, "Office");
        assert.equal(
          ((yield* readJson(`${harness.root}/${id}/profile.json`)) as { name: string }).name,
          "Office",
        );

        const changed = yield* service.setPassword({
          id,
          currentPassword: "first",
          newPassword: "second",
        });
        assert.isTrue(changed.locked);
        assert.equal(
          yield* reasonOf(service.setPassword({ id, currentPassword: null, newPassword: null })),
          "PasswordRequired",
        );
        const removed = yield* service.setPassword({
          id,
          currentPassword: "second",
          newPassword: null,
        });
        assert.isFalse(removed.locked);
        assert.isFalse((yield* service.rename({ id, name: "Work", password: null })).locked);

        const lockedDefault = yield* service.setPassword({
          id: "default" as ProfileId,
          currentPassword: null,
          newPassword: "mine",
        });
        assert.deepEqual([lockedDefault.isDefault, lockedDefault.locked], [true, true]);
      }),
    ),
  );

  it.effect("moves a profile and its userData to the Trash, and adopts it when put back", () =>
    withService((service, harness) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const profile = yield* service.create({ name: "Work", password: null });
        const home = `${harness.root}/${profile.id}`;
        const userData = `${harness.appData}/t3code-v2-profile-${profile.id}`;
        yield* fs.makeDirectory(userData, { recursive: true });

        assert.equal(
          yield* reasonOf(service.moveToTrash({ id: "default" as ProfileId, password: null })),
          "DefaultProfileProtected",
        );
        yield* service.moveToTrash({ id: profile.id, password: null });
        assert.deepEqual(harness.trashed, [home, userData]);
        yield* fs.rename(home, `${harness.trashDir}/${profile.id}`);
        assert.deepEqual(
          (yield* service.list).map((entry) => entry.id),
          ["default"],
        );

        yield* fs.rename(`${harness.trashDir}/${profile.id}`, home);
        assert.deepEqual(
          (yield* service.list).map((entry) => [entry.id, entry.name]),
          [
            ["default", null],
            [profile.id, "Work"],
          ],
        );
      }),
    ),
  );

  it.effect("refuses to move a running profile to the Trash", () =>
    withService((service, harness) =>
      Effect.gen(function* () {
        const profile = yield* service.create({ name: "Work", password: null });
        const lock = new NodeSqlite.DatabaseSync(
          `${harness.root}/${profile.id}/userdata/server-owner.sqlite`,
        );
        lock.exec("BEGIN EXCLUSIVE;");
        const reason = yield* reasonOf(service.moveToTrash({ id: profile.id, password: null }));
        lock.close();
        assert.equal(reason, "ProfileInUse");
        assert.deepEqual(harness.trashed, []);
      }),
    ),
  );

  it.effect("open records last used, writes the intent and relaunches once", () =>
    withService((service, harness) =>
      Effect.gen(function* () {
        const profile = yield* service.create({ name: "Work", password: "secret" });
        yield* service.open({ id: profile.id, password: "secret" });
        assert.equal(harness.relaunches.count, 1);
        assert.deepEqual(yield* readJson(`${harness.root}/launch-intent.json`), {
          version: 1,
          createdAt: NOW.toISOString(),
          target: { kind: "profile", profileId: profile.id, unlocked: true },
        });
        assert.equal(
          (yield* readJson(`${harness.root}/profiles.json`)).lastUsedProfileId,
          profile.id,
        );
        assert.isTrue(
          (yield* service.list).some((entry) => entry.id === profile.id && entry.lastUsed),
        );
      }),
    ),
  );

  it.effect("opening Default with Default alone writes the intent but no registry", () =>
    withService((service, harness) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* service.open({ id: "default" as ProfileId, password: null });
        assert.equal(harness.relaunches.count, 1);
        assert.deepEqual(yield* fs.readDirectory(harness.root), ["launch-intent.json"]);
      }),
    ),
  );

  it.effect("open with a wrong password waits a second, writes nothing and does not relaunch", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const harness = yield* makeHarness;
      const id = "pa1b2c3d4e5";
      yield* fs.makeDirectory(harness.root, { recursive: true });
      // A hash of the wrong length fails verification without scrypt, so nothing awaits I/O.
      yield* fs.writeFileString(
        `${harness.root}/profiles.json`,
        JSON.stringify({
          version: 1,
          profiles: [
            {
              id,
              name: "Work",
              createdAt: NOW.toISOString(),
              lock: { kdf: "scrypt", N: 1024, r: 8, p: 1, keyLength: 64, salt: "", hash: "" },
            },
          ],
        }),
      );
      const service = yield* ProfileService.pipe(
        Effect.provide(
          serviceLayer(harness).pipe(
            Layer.provide(Layer.mergeAll(DesktopPreReadyFileSystem.layer, NodePath.layer)),
          ),
        ),
      );
      const fiber = yield* Effect.forkChild(
        Effect.flip(service.open({ id: id as ProfileId, password: "wrong" })),
      );
      yield* TestClock.adjust("999 millis");
      assert.isUndefined(fiber.pollUnsafe());
      yield* TestClock.adjust("1 millis");
      assert.equal((yield* Fiber.join(fiber)).reason, "WrongPassword");
      assert.equal(harness.relaunches.count, 0);
      assert.isFalse(yield* fs.exists(`${harness.root}/launch-intent.json`));
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
