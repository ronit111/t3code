import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { clearStaleGpuCaches, resolveUserDataPath } from "./DesktopUserData.ts";

it.effect.each(["t3code", "T3 Code (Alpha)"])(
  "preserves Windows credential keys from %s without copying browser databases",
  (sourceName) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-v2-profile-" });
      const source = path.join(directory, sourceName);
      const destination = path.join(directory, "t3code-v2");
      const state = '{"os_crypt":{"encrypted_key":"test-encrypted-key"}}';
      yield* fs.makeDirectory(path.join(directory, "T3 Code (Alpha)"), { recursive: true });
      yield* fs.makeDirectory(path.join(source, "IndexedDB"), { recursive: true });
      yield* fs.writeFileString(path.join(source, "Local State"), state);
      yield* fs.writeFileString(path.join(source, "IndexedDB", "LOCK"), "V1 owns this database");
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(yield* fs.readFileString(path.join(destination, "Local State")), state);
      assert.equal(yield* fs.readFileString(path.join(source, "Local State")), state);
      assert.isFalse(yield* fs.exists(path.join(destination, "IndexedDB")));
      yield* fs.writeFileString(path.join(destination, "Local State"), "existing V2 state");
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(
        yield* fs.readFileString(path.join(destination, "Local State")),
        "existing V2 state",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

const gpuCacheDirectories = [
  "GPUCache",
  "GrShaderCache",
  "ShaderCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "GPUPersistentCache",
];

it.effect.each([
  { profile: "written by Electron 44.10.0", marker: "44.10.0" },
  { profile: "with no recorded Electron version", marker: undefined },
])("clears GPU caches $profile once when Electron 44.10.1 starts", ({ marker }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const userDataPath = yield* fs.makeTempDirectoryScoped({ prefix: "t3-v2-gpu-cache-" });
    for (const name of gpuCacheDirectories) {
      yield* fs.makeDirectory(path.join(userDataPath, name), { recursive: true });
      yield* fs.writeFileString(path.join(userDataPath, name, "data_0"), "44.10.0 shaders");
    }
    yield* fs.makeDirectory(path.join(userDataPath, "Local Storage"), { recursive: true });
    yield* fs.writeFileString(path.join(userDataPath, "Local Storage", "LOCK"), "profile");
    yield* fs.writeFileString(path.join(userDataPath, "Local State"), "profile");
    if (marker !== undefined) {
      yield* fs.writeFileString(path.join(userDataPath, "gpu-cache-electron-version"), marker);
    }

    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });

    const survivingCaches: Array<string> = [];
    for (const name of gpuCacheDirectories) {
      if (yield* fs.exists(path.join(userDataPath, name))) survivingCaches.push(name);
    }
    assert.deepStrictEqual(survivingCaches, []);
    assert.equal(
      yield* fs.readFileString(path.join(userDataPath, "Local Storage", "LOCK")),
      "profile",
    );
    assert.equal(yield* fs.readFileString(path.join(userDataPath, "Local State")), "profile");

    yield* fs.makeDirectory(path.join(userDataPath, "GPUCache"));
    yield* fs.writeFileString(path.join(userDataPath, "GPUCache", "data_0"), "44.10.1 shaders");
    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });
    assert.equal(
      yield* fs.readFileString(path.join(userDataPath, "GPUCache", "data_0")),
      "44.10.1 shaders",
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps GPU caches built on the first launch of a fresh install", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const appData = yield* fs.makeTempDirectoryScoped({ prefix: "t3-v2-fresh-" });
    const userDataPath = path.join(appData, "t3code-v2");

    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });
    yield* fs.makeDirectory(path.join(userDataPath, "GPUCache"));
    yield* fs.writeFileString(path.join(userDataPath, "GPUCache", "data_0"), "44.10.1 shaders");
    yield* clearStaleGpuCaches({ userDataPath, electronVersion: "44.10.1" });

    assert.equal(
      yield* fs.readFileString(path.join(userDataPath, "GPUCache", "data_0")),
      "44.10.1 shaders",
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("retries on the next launch when a GPU cache cannot be removed", () =>
  Effect.gen(function* () {
    const writes: Array<string> = [];
    const fileSystem = FileSystem.makeNoop({
      remove: (path) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "remove",
            pathOrDescriptor: path,
          }),
        ),
      writeFileString: (path) =>
        Effect.sync(() => {
          writes.push(path);
        }),
    });

    yield* clearStaleGpuCaches({ userDataPath: "/profile", electronVersion: "44.10.1" }).pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
    );

    assert.deepStrictEqual(writes, []);
  }).pipe(Effect.provide(NodeServices.layer)),
);

const recordingFileSystem = (existing: ReadonlySet<string>) => {
  const calls: Array<string> = [];
  const layer = Layer.succeed(
    FileSystem.FileSystem,
    FileSystem.makeNoop({
      exists: (path) =>
        Effect.sync(() => {
          calls.push(path);
          return existing.has(path);
        }),
    }),
  );
  return { calls, layer };
};

it.effect.each([
  { name: "packaged", isDevelopment: false, legacy: false, expected: "/appData/t3code-v2" },
  { name: "dev", isDevelopment: true, legacy: false, expected: "/appData/t3code-dev" },
  {
    name: "dev with the legacy folder",
    isDevelopment: true,
    legacy: true,
    expected: "/appData/T3 Code (Dev)",
  },
])("the Default profile keeps today's userData: $name", ({ isDevelopment, legacy, expected }) =>
  Effect.gen(function* () {
    const existing = new Set(legacy ? ["/appData/T3 Code (Dev)"] : []);
    const input = { appDataDirectory: "/appData", isDevelopment, platform: "darwin" as const };
    const absent = recordingFileSystem(existing);
    const none = recordingFileSystem(existing);
    assert.equal(yield* resolveUserDataPath(input).pipe(Effect.provide(absent.layer)), expected);
    assert.equal(
      yield* resolveUserDataPath({ ...input, electronUserDataOverride: Option.none() }).pipe(
        Effect.provide(none.layer),
      ),
      expected,
    );
    assert.deepEqual(none.calls, absent.calls);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("another profile's userData override skips every lookup", () =>
  Effect.gen(function* () {
    const recording = recordingFileSystem(new Set());
    const override = "/appData/t3code-v2-profile-pa1b2c3d4e5";
    assert.equal(
      yield* resolveUserDataPath({
        appDataDirectory: "/appData",
        isDevelopment: true,
        platform: "win32",
        electronUserDataOverride: Option.some(override),
      }).pipe(Effect.provide(recording.layer)),
      override,
    );
    assert.deepEqual(recording.calls, []);
  }).pipe(Effect.provide(NodeServices.layer)),
);
