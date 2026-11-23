import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Electron from "electron";
import { msg } from "gt-i18n";

import * as HostProcess from "@t3tools/shared/HostProcess";

import * as ElectronApp from "../../electron/ElectronApp.ts";
import { applyLanguage, m } from "../../i18n/messages.ts";
import type { PickerLaunch, ProfileService } from "../ProfileContract.ts";
import { PROFILE_PICKER_HTML } from "./ProfilePickerHtml.ts";
import { registerPickerIpc } from "./ProfilePickerIpc.ts";
import { pickerStrings } from "./ProfilePickerStrings.ts";

export type PickerApp = Pick<Electron.App, "setPath" | "requestSingleInstanceLock" | "quit" | "on">;

export interface PickerProcessDeps {
  readonly app: PickerApp;
  readonly layer: Layer.Layer<ProfileService>;
  /** Tests replace NodeRuntime.runMain, which installs signal handlers and exits. */
  readonly runMain?: <E>(program: Effect.Effect<void, E>) => void;
}

interface PickerWindowRef {
  current: Electron.BrowserWindow | null;
}

const PICKER_PRELOAD = "profile-picker-preload.cjs";

const setPickerMenu = () => {
  const appName = Electron.app.name;
  Electron.Menu.setApplicationMenu(
    Electron.Menu.buildFromTemplate([
      {
        label: appName,
        submenu: [
          { role: "about", label: m(msg("About {appName}"), { appName }) },
          { type: "separator" },
          { role: "quit", label: m(msg("Quit {appName}"), { appName }) },
        ],
      },
      {
        label: m(msg("Edit", { $context: "menu bar title" })),
        submenu: [
          { role: "undo", label: m(msg("Undo", { $context: "Edit menu item" })) },
          { role: "redo", label: m(msg("Redo", { $context: "Edit menu item" })) },
          { type: "separator" },
          { role: "cut", label: m(msg("Cut", { $context: "Edit menu item" })) },
          { role: "copy", label: m(msg("Copy", { $context: "Edit menu item" })) },
          { role: "paste", label: m(msg("Paste", { $context: "Edit menu item" })) },
          { role: "selectAll", label: m(msg("Select All", { $context: "Edit menu item" })) },
        ],
      },
    ]),
  );
};

/** The picker's main-process program: it builds no environment, Clerk, observability or backend. */
const program = Effect.fn("DesktopProfiles.pickerProgram")(function* (
  launch: PickerLaunch,
  windowRef: PickerWindowRef,
) {
  const electronApp = yield* ElectronApp.ElectronApp;
  yield* electronApp.whenReady;
  // The picker reads nothing from a profile home, so it follows the system language.
  yield* applyLanguage("system");
  setPickerMenu();
  const platform = yield* HostProcess.Platform;

  const window = new Electron.BrowserWindow({
    width: 480,
    height: 520,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    // Matches the page canvas (zinc-25 or black) so the window never flashes the other theme.
    backgroundColor: Electron.nativeTheme.shouldUseDarkColors ? "#000000" : "#fcfcfc",
    ...(platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    title: pickerStrings(launch.notice).windowTitle,
    webPreferences: {
      preload: `${__dirname}/${PICKER_PRELOAD}`,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  windowRef.current = window;
  window.once("ready-to-show", () => window.show());
  window.once("closed", () => {
    windowRef.current = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  yield* registerPickerIpc({
    ipcMain: Electron.ipcMain,
    window,
    launch,
    confirm: (dialog) =>
      Effect.promise(() =>
        Electron.dialog.showMessageBox(window, {
          type: "warning",
          message: dialog.message,
          buttons: [dialog.confirm, dialog.cancel],
          defaultId: 1,
          cancelId: 1,
        }),
      ).pipe(Effect.map(({ response }) => response === 0)),
    showItemInFolder: (path) => Electron.shell.showItemInFolder(path),
    quit: () => Electron.app.quit(),
  });

  yield* Effect.promise(() =>
    window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PROFILE_PICKER_HTML)}`),
  );
  return yield* Effect.never;
});

/** Runs before Electron is ready: userData and the single-instance lock must be set first. */
export const startPickerProcess = (launch: PickerLaunch, deps: PickerProcessDeps): void => {
  const { app } = deps;
  app.setPath("userData", launch.userDataPath);
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  const windowRef: PickerWindowRef = { current: null };
  const focus = () => {
    const window = windowRef.current;
    if (window === null || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  app.on("second-instance", focus);
  app.on("activate", focus);
  app.on("window-all-closed", () => app.quit());
  const runMain = deps.runMain ?? ((effect) => NodeRuntime.runMain(effect));
  runMain(
    program(launch, windowRef).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(ElectronApp.layer, deps.layer)),
    ),
  );
};
