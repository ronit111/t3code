import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { vi } from "vite-plus/test";

vi.mock("electron", () => ({
  app: { name: "T3 Code" },
  BrowserWindow: vi.fn(),
  Menu: {},
  dialog: {},
  ipcMain: {},
  shell: {},
}));

import type { PickerLaunch } from "../ProfileContract.ts";
import { ProfileService } from "../ProfileContract.ts";
import { type PickerApp, startPickerProcess } from "./ProfilePickerProgram.ts";

const launch: PickerLaunch = {
  _tag: "Picker",
  profilesRoot: "/Users/u/.t3-profiles",
  userDataPath: "/Users/u/Library/Application Support/t3code-v2-picker",
  appDataDirectory: "/Users/u/Library/Application Support",
  defaultHome: "/Users/u/.t3",
  isDevelopment: false,
  unlockProfileId: null,
  notice: { _tag: "None" },
};

const fakeApp = (gotLock: boolean) => {
  const calls: Array<string> = [];
  const app = {
    setPath: (name: string, path: string) => calls.push(`setPath ${name} ${path}`),
    requestSingleInstanceLock: () => {
      calls.push("requestSingleInstanceLock");
      return gotLock;
    },
    quit: () => calls.push("quit"),
    on: (event: string) => {
      calls.push(`on ${event}`);
      return app;
    },
  };
  return { app: app as unknown as PickerApp, calls };
};

const layer = Layer.mock(ProfileService, {});

describe("startPickerProcess", () => {
  it("quits without starting the program when another picker holds the lock", () => {
    const { app, calls } = fakeApp(false);
    const runMain = vi.fn();
    startPickerProcess(launch, { app, layer, runMain });
    assert.deepStrictEqual(calls, [
      `setPath userData ${launch.userDataPath}`,
      "requestSingleInstanceLock",
      "quit",
    ]);
    assert.strictEqual(runMain.mock.calls.length, 0);
  });

  it("sets userData and the lock before it starts the program", () => {
    const { app, calls } = fakeApp(true);
    const runMain = vi.fn((_program: unknown) => calls.push("runMain"));
    startPickerProcess(launch, { app, layer, runMain });
    assert.deepStrictEqual(calls, [
      `setPath userData ${launch.userDataPath}`,
      "requestSingleInstanceLock",
      "on second-instance",
      "on activate",
      "on window-all-closed",
      "runMain",
    ]);
    assert.isTrue(Effect.isEffect(runMain.mock.calls[0]?.[0]));
  });
});
