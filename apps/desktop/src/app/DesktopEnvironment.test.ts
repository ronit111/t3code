import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { OpenLaunch, ProfileId } from "../profiles/ProfileContract.ts";
import { defaultOpenLaunch } from "../profiles/ProfileLaunch.ts";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const layerEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest(env)),
    ),
  );

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) => DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(layerEnvironment(overrides, env)));

describe("DesktopEnvironment", () => {
  it.effect("uses the packaged Windows server sidecar as the backend root", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        platform: "win32",
        isPackaged: true,
        appPath: "/install/resources/app.asar",
        resourcesPath: "/install/resources",
      });

      assert.equal(environment.appRoot, "/install/resources/app.asar");
      assert.equal(environment.serverRoot, "/install/resources/server.asar");
      assert.equal(
        environment.backendEntryPath,
        "/install/resources/server.asar/apps/server/dist/bin.mjs",
      );
      assert.equal(
        environment.clientAssetsDir,
        "/install/resources/server.asar/apps/server/dist/client",
      );
    }),
  );

  it.effect("keeps implicit development state separate from production state", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment();

      assert.equal(development.stateDir, "/Users/alice/.t3/dev");
      assert.equal(production.stateDir, "/Users/alice/.t3/userdata");
    }),
  );

  it.effect.each([
    {
      mode: "packaged",
      t3Home: undefined,
      baseDir: "/Users/alice/.t3",
      stateDir: "/Users/alice/.t3/userdata",
    },
    {
      mode: "dev",
      t3Home: undefined,
      baseDir: "/Users/alice/.t3",
      stateDir: "/Users/alice/.t3/dev",
    },
    {
      mode: "packaged",
      t3Home: "/custom/t3",
      baseDir: "/custom/t3",
      stateDir: "/custom/t3/userdata",
    },
    { mode: "dev", t3Home: "/custom/t3", baseDir: "/custom/t3", stateDir: "/custom/t3/userdata" },
  ])(
    "the Default profile keeps today's paths ($mode, T3CODE_HOME=$t3Home)",
    ({ mode, t3Home, baseDir, stateDir }) =>
      Effect.gen(function* () {
        const env = {
          T3CODE_HOME: t3Home,
          VITE_DEV_SERVER_URL: mode === "dev" ? "http://localhost:5173" : undefined,
        };
        const overrides = { isPackaged: mode === "packaged" };
        const absent = yield* makeEnvironment(overrides, env);
        const explicitDefault = yield* makeEnvironment(
          {
            ...overrides,
            profile: defaultOpenLaunch({
              profilesRoot: "/Users/alice/.t3-profiles",
              registryExists: true,
              name: null,
            }),
          },
          env,
        );
        for (const environment of [absent, explicitDefault]) {
          assert.equal(environment.baseDir, baseDir);
          assert.equal(environment.stateDir, stateDir);
          assert.isTrue(Option.isNone(environment.electronUserDataOverride));
          assert.isTrue(environment.profile.isDefault);
        }
        for (const key of [
          "desktopSettingsPath",
          "serverSettingsPath",
          "clientSettingsPath",
          "logDir",
          "appDataDirectory",
        ] as const) {
          assert.equal(explicitDefault[key], absent[key], key);
        }
        assert.isNull(absent.profile.profilesRoot);
      }),
  );

  it.effect("another profile gets its own home and Electron userData", () =>
    Effect.gen(function* () {
      const id = "pa1b2c3d4e5" as ProfileId;
      const profile: OpenLaunch = {
        _tag: "Open",
        profile: {
          id,
          name: "Work",
          isDefault: false,
          profilesRoot: "/Users/alice/.t3-profiles",
          registryExists: true,
        },
        home: `/Users/alice/.t3-profiles/${id}`,
        userDataPath: `/Users/alice/Library/Application Support/t3code-v2-profile-${id}`,
      };
      const environment = yield* makeEnvironment(
        { isPackaged: true, profile },
        { T3CODE_HOME: "/custom/t3" },
      );
      assert.equal(environment.baseDir, profile.home);
      assert.equal(environment.stateDir, `${profile.home}/userdata`);
      assert.equal(environment.serverSettingsPath, `${profile.home}/userdata/settings.json`);
      assert.deepEqual(environment.electronUserDataOverride, Option.some(profile.userDataPath));
      assert.deepEqual(environment.profile, profile.profile);
    }),
  );
});
