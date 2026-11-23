import { assert, describe, it } from "@effect/vitest";

import { relaunchElectronApp, stripProfileArgs } from "./ProfileRelaunch.ts";

const fakeApp = () => {
  const calls: Array<unknown> = [];
  return {
    calls,
    app: {
      relaunch: (options?: Electron.RelaunchOptions) => {
        calls.push(["relaunch", options]);
      },
      exit: (code?: number) => {
        calls.push(["exit", code]);
      },
    },
  };
};

describe("ProfileRelaunch", () => {
  it("removes every profile argument and keeps the rest", () => {
    assert.deepEqual(
      stripProfileArgs([
        "--t3-profile=pa1b2c3d4e5",
        "--no-sandbox",
        "--t3-profile-picker",
        "--t3-profile=default",
        "--t3-profiles-other",
      ]),
      ["--no-sandbox", "--t3-profiles-other"],
    );
  });

  it("relaunches the packaged app without profile arguments", () => {
    const { app, calls } = fakeApp();
    relaunchElectronApp({
      app,
      execPath: "/Applications/T3 Code.app/Contents/MacOS/T3 Code",
      argv: ["/Applications/T3 Code.app/Contents/MacOS/T3 Code", "--t3-profile-picker", "--x"],
      isDevelopment: false,
    });
    assert.deepEqual(calls, [
      ["relaunch", { execPath: "/Applications/T3 Code.app/Contents/MacOS/T3 Code", args: ["--x"] }],
      ["exit", 0],
    ]);
  });

  it("exits with 75 in development and does not relaunch", () => {
    const { app, calls } = fakeApp();
    relaunchElectronApp({ app, execPath: "electron", argv: ["electron"], isDevelopment: true });
    assert.deepEqual(calls, [["exit", 75]]);
  });
});
