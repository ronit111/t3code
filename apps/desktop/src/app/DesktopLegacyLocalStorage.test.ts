import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({}));

import { ProfileId, type OpenLaunch } from "../profiles/ProfileContract.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLegacyLocalStorage from "./DesktopLegacyLocalStorage.ts";

const PROFILE_ID = Schema.decodeSync(ProfileId)("p0123456789");

const loadInto = (homeDirectory: string, userDataPath: string, profile?: OpenLaunch) =>
  Effect.gen(function* () {
    const legacy = yield* DesktopLegacyLocalStorage.DesktopLegacyLocalStorage;
    yield* legacy.load(userDataPath);
    return yield* legacy.take;
  }).pipe(
    Effect.provide(
      DesktopLegacyLocalStorage.layer.pipe(
        Layer.provide(
          DesktopEnvironment.layer({
            dirname: "/repo/apps/desktop/dist-electron",
            homeDirectory,
            platform: "darwin",
            processArch: "arm64",
            appVersion: "1.2.3",
            appPath: "/repo",
            isPackaged: true,
            resourcesPath: "/missing/resources",
            runningUnderArm64Translation: false,
            ...(profile === undefined ? {} : { profile }),
          }),
        ),
        Layer.provide(
          Layer.mergeAll(
            NodeServices.layer,
            DesktopConfig.layerTest({ T3CODE_HOME: homeDirectory }),
          ),
        ),
      ),
    ),
  );

describe("DesktopLegacyLocalStorage", () => {
  it.effect("imports V1 Local Storage only into the Default profile", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const homeDirectory = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-desktop-legacy-storage-test-",
      });
      const id = PROFILE_ID;
      const profile: OpenLaunch = {
        _tag: "Open",
        profile: {
          id,
          name: "Work",
          isDefault: false,
          profilesRoot: path.join(homeDirectory, "profiles"),
          registryExists: true,
        },
        home: path.join(homeDirectory, "profiles", id),
        userDataPath: path.join(homeDirectory, "profile-userdata"),
      };

      for (const row of [
        { launch: undefined, userData: "default-userdata", checked: true },
        { launch: profile, userData: "profile-userdata", checked: false },
      ]) {
        const userDataPath = path.join(homeDirectory, row.userData);
        yield* fileSystem.makeDirectory(userDataPath, { recursive: true });
        const items = yield* loadInto(homeDirectory, userDataPath, row.launch);
        assert.isTrue(Option.isNone(items));
        assert.equal(
          yield* fileSystem.exists(path.join(userDataPath, "v1-local-storage-imported")),
          row.checked,
        );
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
