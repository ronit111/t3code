import * as Option from "effect/Option";

import type { JoinPath } from "../app/DesktopStatePaths.ts";
import { resolveDesktopBaseDir } from "../app/DesktopStatePaths.ts";
import { PROFILES_HOME_ENV } from "./ProfileContract.ts";

const REGISTRY_FILE_NAME = "profiles.json";
const LAUNCH_INTENT_FILE_NAME = "launch-intent.json";
const PROFILE_MIRROR_FILE_NAME = "profile.json";

const trimmedOption = (value: string | undefined): Option.Option<string> => {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
};

/** null when profiles are off: not macOS, or development without T3CODE_PROFILES_HOME. */
export const resolveProfilesRoot = (input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
}): string | null => {
  if (input.platform !== "darwin") return null;
  const configured = trimmedOption(input.env[PROFILES_HOME_ENV]);
  if (Option.isSome(configured)) return configured.value;
  return input.isDevelopment ? null : input.joinPath(input.homeDirectory, ".t3-profiles");
};

/** Today's Default home: T3CODE_HOME or ~/.t3. */
export const resolveDefaultHome = (input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
}): string =>
  resolveDesktopBaseDir({
    homeDirectory: input.homeDirectory,
    joinPath: input.joinPath,
    t3Home: trimmedOption(input.env.T3CODE_HOME),
  });

export const resolveAppDataDirectory = (input: {
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly appData: Option.Option<string>;
  readonly xdgConfigHome: Option.Option<string>;
  readonly joinPath: JoinPath;
}): string =>
  input.platform === "win32"
    ? Option.getOrElse(input.appData, () =>
        input.joinPath(input.homeDirectory, "AppData", "Roaming"),
      )
    : input.platform === "darwin"
      ? input.joinPath(input.homeDirectory, "Library", "Application Support")
      : Option.getOrElse(input.xdgConfigHome, () => input.joinPath(input.homeDirectory, ".config"));

export const registryPath = (profilesRoot: string, joinPath: JoinPath): string =>
  joinPath(profilesRoot, REGISTRY_FILE_NAME);

export const launchIntentPath = (profilesRoot: string, joinPath: JoinPath): string =>
  joinPath(profilesRoot, LAUNCH_INTENT_FILE_NAME);

export const profileHome = (profilesRoot: string, id: string, joinPath: JoinPath): string =>
  joinPath(profilesRoot, id);

/** The server settings seeding writes; its provider homes keep a profile off the shared ones. */
export const seededSettingsPath = (home: string, joinPath: JoinPath): string =>
  joinPath(home, "userdata", "settings.json");

export const profileMirrorPath = (profilesRoot: string, id: string, joinPath: JoinPath): string =>
  joinPath(profilesRoot, id, PROFILE_MIRROR_FILE_NAME);

export const profileUserDataPath = (input: {
  readonly appDataDirectory: string;
  readonly id: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
}): string =>
  input.joinPath(
    input.appDataDirectory,
    `${input.isDevelopment ? "t3code-dev" : "t3code-v2"}-profile-${input.id}`,
  );

export const pickerUserDataPath = (input: {
  readonly appDataDirectory: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
}): string =>
  input.joinPath(
    input.appDataDirectory,
    input.isDevelopment ? "t3code-dev-picker" : "t3code-v2-picker",
  );
