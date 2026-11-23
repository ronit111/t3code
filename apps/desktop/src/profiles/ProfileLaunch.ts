// @effect-diagnostics nodeBuiltinImport:off - The launch decision runs synchronously before any Effect runtime exists.
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  DEFAULT_PROFILE_ID,
  PROFILE_ARG_PREFIX,
  PROFILE_PICKER_ARG,
  ProfileId,
  type LaunchIntentTarget,
  type OpenLaunch,
  type PickerLaunch,
  type PickerNotice,
  type ProfileLaunch,
} from "./ProfileContract.ts";
import {
  launchIntentPath,
  pickerUserDataPath,
  profileHome,
  profileUserDataPath,
  registryPath,
  resolveAppDataDirectory,
  resolveDefaultHome,
  resolveProfilesRoot,
} from "./ProfilePaths.ts";
import {
  decodeRegistryText,
  defaultProfileId,
  emptyRegistry,
  writeFileAtomic,
  type ProfileRegistry,
} from "./ProfileRegistry.ts";

const INTENT_MAX_AGE_MS = 120_000;
const INTENT_MAX_FUTURE_MS = 5_000;

export interface ProfileLaunchFileSystem {
  readonly exists: (path: string) => boolean;
  readonly readFile: (path: string) => string;
  readonly unlink: (path: string) => void;
}

export interface ResolveProfileLaunchInput {
  readonly argv: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly platform: NodeJS.Platform;
  readonly homeDirectory: string;
  readonly now: Date;
  readonly isDevelopment: boolean;
  readonly fs: ProfileLaunchFileSystem;
}

const LaunchIntentTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("picker") }),
  Schema.Struct({
    kind: Schema.Literal("profile"),
    profileId: ProfileId,
    unlocked: Schema.Boolean,
  }),
]);

const LaunchIntentDocument = Schema.Struct({
  version: Schema.Literal(1),
  createdAt: Schema.String,
  target: LaunchIntentTargetSchema,
});

const decodeLaunchIntentText = Schema.decodeUnknownOption(
  Schema.fromJsonString(LaunchIntentDocument),
);
const encodeLaunchIntentText = Schema.encodeSync(Schema.fromJsonString(LaunchIntentDocument));

/** The Default profile with today's paths. */
export const defaultOpenLaunch = (input: {
  readonly profilesRoot: string | null;
  readonly registryExists: boolean;
  readonly name: string | null;
}): OpenLaunch => ({
  _tag: "Open",
  profile: {
    id: defaultProfileId,
    name: input.name,
    isDefault: true,
    profilesRoot: input.profilesRoot,
    registryExists: input.registryExists,
  },
  home: null,
  userDataPath: null,
});

const decodeValidIntent = (text: string, now: Date): Option.Option<LaunchIntentTarget> =>
  decodeLaunchIntentText(text).pipe(
    Option.filter((intent) => {
      const createdAt = Date.parse(intent.createdAt);
      if (Number.isNaN(createdAt)) return false;
      const age = now.getTime() - createdAt;
      return age <= INTENT_MAX_AGE_MS && age >= -INTENT_MAX_FUTURE_MS;
    }),
    Option.map((intent) => intent.target),
  );

/** Reads the one-shot intent and always deletes it, valid or not, before anything acts on it. */
const consumeLaunchIntent = (
  fs: ProfileLaunchFileSystem,
  filePath: string,
  now: Date,
): Option.Option<LaunchIntentTarget> => {
  if (!fs.exists(filePath)) return Option.none();
  let text: string | null = null;
  try {
    text = fs.readFile(filePath);
  } catch {
    text = null;
  }
  try {
    fs.unlink(filePath);
  } catch {
    // A file that cannot be deleted is still ignored when it goes stale.
  }
  return text === null ? Option.none() : decodeValidIntent(text, now);
};

type ArgumentTarget =
  | { readonly kind: "picker" }
  | { readonly kind: "profile"; readonly profileId: string };

const argumentTarget = (argv: ReadonlyArray<string>): Option.Option<ArgumentTarget> => {
  let target = Option.none<ArgumentTarget>();
  for (const arg of argv) {
    if (arg === PROFILE_PICKER_ARG) target = Option.some({ kind: "picker" });
    else if (arg.startsWith(PROFILE_ARG_PREFIX)) {
      target = Option.some({ kind: "profile", profileId: arg.slice(PROFILE_ARG_PREFIX.length) });
    }
  }
  return target;
};

type RegistryRead =
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Unreadable" }
  | { readonly _tag: "Read"; readonly registry: ProfileRegistry };

const readRegistrySync = (fs: ProfileLaunchFileSystem, filePath: string): RegistryRead => {
  if (!fs.exists(filePath)) return { _tag: "Missing" };
  let text: string;
  try {
    text = fs.readFile(filePath);
  } catch {
    return { _tag: "Unreadable" };
  }
  return Option.match(decodeRegistryText(text), {
    onNone: () => ({ _tag: "Unreadable" }) as const,
    onSome: (registry) => ({ _tag: "Read", registry }) as const,
  });
};

export const resolveProfileLaunchSync = (input: ResolveProfileLaunchInput): ProfileLaunch => {
  const joinPath = NodePath.join;
  const profilesRoot = resolveProfilesRoot({
    env: input.env,
    platform: input.platform,
    homeDirectory: input.homeDirectory,
    isDevelopment: input.isDevelopment,
    joinPath,
  });
  if (profilesRoot === null) {
    return defaultOpenLaunch({ profilesRoot: null, registryExists: false, name: null });
  }

  const appDataDirectory = resolveAppDataDirectory({
    platform: input.platform,
    homeDirectory: input.homeDirectory,
    appData: Option.fromUndefinedOr(input.env.APPDATA),
    xdgConfigHome: Option.fromUndefinedOr(input.env.XDG_CONFIG_HOME),
    joinPath,
  });
  const picker = (
    notice: PickerNotice,
    unlockProfileId: ProfileId | null = null,
  ): PickerLaunch => ({
    _tag: "Picker",
    profilesRoot,
    userDataPath: pickerUserDataPath({
      appDataDirectory,
      isDevelopment: input.isDevelopment,
      joinPath,
    }),
    appDataDirectory,
    defaultHome: resolveDefaultHome({
      env: input.env,
      homeDirectory: input.homeDirectory,
      joinPath,
    }),
    isDevelopment: input.isDevelopment,
    unlockProfileId,
    notice,
  });

  const intent = consumeLaunchIntent(input.fs, launchIntentPath(profilesRoot, joinPath), input.now);
  const registryFile = registryPath(profilesRoot, joinPath);
  const read = readRegistrySync(input.fs, registryFile);
  if (read._tag === "Unreadable") {
    return picker({ _tag: "RegistryUnreadable", registryPath: registryFile });
  }
  const registryExists = read._tag === "Read";
  const registry = read._tag === "Read" ? read.registry : emptyRegistry();

  const target: ArgumentTarget = Option.getOrElse(
    Option.orElse(intent, () => argumentTarget(input.argv)),
    (): ArgumentTarget =>
      registry.profiles.length >= 2
        ? { kind: "picker" }
        : { kind: "profile", profileId: DEFAULT_PROFILE_ID },
  );
  if (target.kind === "picker") return picker({ _tag: "None" });

  const entry = registry.profiles.find((candidate) => candidate.id === target.profileId);
  if (entry === undefined) {
    return picker({ _tag: "ProfileNotFound", requestedId: target.profileId });
  }
  const unlockedByIntent = Option.exists(
    intent,
    (unlocked) =>
      unlocked.kind === "profile" && unlocked.profileId === entry.id && unlocked.unlocked,
  );
  if (entry.lock !== null && !unlockedByIntent) {
    return picker({ _tag: "None" }, entry.id);
  }
  if (entry.id === DEFAULT_PROFILE_ID) {
    return defaultOpenLaunch({ profilesRoot, registryExists, name: entry.name });
  }
  return {
    _tag: "Open",
    profile: {
      id: entry.id,
      name: entry.name,
      isDefault: false,
      profilesRoot,
      registryExists,
    },
    home: profileHome(profilesRoot, entry.id, joinPath),
    userDataPath: profileUserDataPath({
      appDataDirectory,
      id: entry.id,
      isDevelopment: input.isDevelopment,
      joinPath,
    }),
  };
};

export const writeLaunchIntent = Effect.fn("DesktopProfiles.writeLaunchIntent")(function* (input: {
  readonly profilesRoot: string;
  readonly target: LaunchIntentTarget;
  readonly createdAt: Date;
}) {
  const path = yield* Path.Path;
  yield* writeFileAtomic(
    launchIntentPath(input.profilesRoot, path.join),
    `${encodeLaunchIntentText({
      version: 1,
      createdAt: input.createdAt.toISOString(),
      target: input.target,
    })}\n`,
  );
});
