import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as Electron from "electron";

import * as HostProcess from "@t3tools/shared/HostProcess";

import type { RunProfilePicker } from "./profiles/ProfileContract.ts";
import { relaunchElectronApp } from "./profiles/ProfileRelaunch.ts";
import * as ProfileServiceLive from "./profiles/ProfileServiceLive.ts";
import { startPickerProcess } from "./profiles/picker/ProfilePickerProgram.ts";

export const runProfilePicker: RunProfilePicker = (launch) =>
  startPickerProcess(launch, {
    app: Electron.app,
    layer: ProfileServiceLive.layer({
      profilesRoot: launch.profilesRoot,
      defaultHome: launch.defaultHome,
      appDataDirectory: launch.appDataDirectory,
      isDevelopment: launch.isDevelopment,
      // @effect-diagnostics-next-line globalDate:off - The service takes a plain clock.
      now: () => new Date(),
      trashItem: (path) => Electron.shell.trashItem(path),
      relaunch: () =>
        relaunchElectronApp({
          app: Electron.app,
          execPath: HostProcess.ExecutablePath.defaultValue(),
          argv: HostProcess.Arguments.defaultValue(),
          isDevelopment: launch.isDevelopment,
        }),
    }).pipe(Layer.provide(NodeServices.layer)),
  });
