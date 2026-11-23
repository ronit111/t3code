import type * as Electron from "electron";

import { PROFILE_ARG_PREFIX, PROFILE_PICKER_ARG } from "./ProfileContract.ts";

/** The launch intent carries the target, so a relaunch never forwards a profile argument. */
export const stripProfileArgs = (args: ReadonlyArray<string>): ReadonlyArray<string> =>
  args.filter((arg) => arg !== PROFILE_PICKER_ARG && !arg.startsWith(PROFILE_ARG_PREFIX));

/**
 * Packaged: app.relaunch({ execPath, args: stripProfileArgs(argv.slice(1)) }) then app.exit(0).
 * Dev: app.exit(75).
 * @public
 */
export const relaunchElectronApp = (input: {
  readonly app: Pick<Electron.App, "relaunch" | "exit">;
  readonly execPath: string;
  readonly argv: ReadonlyArray<string>;
  readonly isDevelopment: boolean;
}): void => {
  if (input.isDevelopment) {
    input.app.exit(75);
    return;
  }
  input.app.relaunch({
    execPath: input.execPath,
    args: [...stripProfileArgs(input.argv.slice(1))],
  });
  input.app.exit(0);
};
