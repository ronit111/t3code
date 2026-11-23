import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopLifecycle from "../app/DesktopLifecycle.ts";
import * as DesktopShutdown from "../app/DesktopShutdown.ts";
import * as DesktopState from "../app/DesktopState.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import {
  DesktopProfileSwitch,
  type ActiveProfile,
  type LaunchIntentTarget,
  type ProfileId,
} from "./ProfileContract.ts";
import * as ProfileSwitch from "./ProfileSwitch.ts";

const active: ActiveProfile = {
  id: "pa1b2c3d4e5" as ProfileId,
  name: "Work",
  isDefault: false,
  profilesRoot: "/Users/u/.t3-profiles",
  registryExists: true,
};

const switchWith = (response: number) =>
  Effect.gen(function* () {
    const relaunches: Array<[string, LaunchIntentTarget | undefined]> = [];
    const layer = ProfileSwitch.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(DesktopLifecycle.DesktopLifecycle, {
            relaunch: (reason, intent) =>
              Effect.sync(() => {
                relaunches.push([reason, intent]);
              }),
          }),
          Layer.mock(ElectronDialog.ElectronDialog, {
            showMessageBox: () => Effect.succeed({ response, checkboxChecked: false }),
          }),
          Layer.succeed(
            DesktopEnvironment.DesktopEnvironment,
            DesktopEnvironment.DesktopEnvironment.of({
              profile: active,
            } as DesktopEnvironment.DesktopEnvironment["Service"]),
          ),
          DesktopShutdown.layer,
          DesktopState.layer,
          Layer.succeed(
            DesktopWindow.DesktopWindow,
            DesktopWindow.DesktopWindow.of({} as DesktopWindow.DesktopWindow["Service"]),
          ),
          Layer.succeed(
            ElectronApp.ElectronApp,
            ElectronApp.ElectronApp.of({} as ElectronApp.ElectronApp["Service"]),
          ),
          Layer.succeed(
            ElectronTheme.ElectronTheme,
            ElectronTheme.ElectronTheme.of({} as ElectronTheme.ElectronTheme["Service"]),
          ),
        ),
      ),
    );
    const profileSwitch = yield* DesktopProfileSwitch.pipe(Effect.provide(layer));
    assert.deepEqual(profileSwitch.active, active);
    return { switched: yield* profileSwitch.switchToPicker, relaunches };
  });

describe("ProfileSwitch", () => {
  it.effect("does nothing when the user cancels", () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* switchWith(1), { switched: false, relaunches: [] });
    }),
  );

  it.effect("relaunches into the picker when the user confirms", () =>
    Effect.gen(function* () {
      assert.deepEqual(yield* switchWith(0), {
        switched: true,
        relaunches: [["profile-switch", { kind: "picker" }]],
      });
    }),
  );
});
