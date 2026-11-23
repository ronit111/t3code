import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const DEFAULT_PROFILE_ID = "default";
export const PROFILE_ID_PATTERN = /^(default|p[0-9a-z]{10})$/;
export const PROFILE_NAME_MAX_LENGTH = 40;
export const PROFILE_PASSWORD_MIN_LENGTH = 4;
export const PROFILE_PASSWORD_MAX_LENGTH = 256;
export const PROFILE_ARG_PREFIX = "--t3-profile=";
export const PROFILE_PICKER_ARG = "--t3-profile-picker";
export const PROFILES_HOME_ENV = "T3CODE_PROFILES_HOME";
export const PROFILE_PICKER_BUNDLE = "profile-picker.cjs";

export const ProfileId = Schema.String.check(Schema.isPattern(PROFILE_ID_PATTERN)).pipe(
  Schema.brand("DesktopProfileId"),
);
export type ProfileId = typeof ProfileId.Type;

export const ProfileSummary = Schema.Struct({
  id: ProfileId,
  /** null only for the Default profile before it is renamed; clients show a translated "Default". */
  name: Schema.NullOr(Schema.String),
  isDefault: Schema.Boolean,
  locked: Schema.Boolean,
  lastUsed: Schema.Boolean,
});
export type ProfileSummary = typeof ProfileSummary.Type;

export const ProfileErrorReason = Schema.Literals([
  "NotFound",
  "WrongPassword",
  "PasswordRequired",
  "InvalidPassword",
  "InvalidName",
  "DuplicateName",
  "DefaultProfileProtected",
  "ProfileInUse",
  "RegistryUnreadable",
  "Io",
]);
export type ProfileErrorReason = typeof ProfileErrorReason.Type;

/** Safe to show: never carries a password or hash. */
export class ProfileError extends Schema.TaggedError<ProfileError>()("DesktopProfileError", {
  reason: ProfileErrorReason,
  profileId: Schema.optional(Schema.String),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}

/** The profile this process serves. Default when profiles are off. */
export interface ActiveProfile {
  readonly id: ProfileId;
  readonly name: string | null;
  readonly isDefault: boolean;
  /** null when profiles are off: not macOS, or development without T3CODE_PROFILES_HOME. */
  readonly profilesRoot: string | null;
  readonly registryExists: boolean;
}

export type PickerNotice =
  | { readonly _tag: "None" }
  | { readonly _tag: "ProfileNotFound"; readonly requestedId: string }
  | { readonly _tag: "RegistryUnreadable"; readonly registryPath: string };

export interface PickerLaunch {
  readonly _tag: "Picker";
  readonly profilesRoot: string;
  readonly userDataPath: string;
  readonly appDataDirectory: string;
  /** Today's Default home: T3CODE_HOME or ~/.t3. */
  readonly defaultHome: string;
  readonly isDevelopment: boolean;
  readonly unlockProfileId: ProfileId | null;
  readonly notice: PickerNotice;
}

export interface OpenLaunch {
  readonly _tag: "Open";
  readonly profile: ActiveProfile;
  /** null for Default: today's T3 home resolution runs unchanged. */
  readonly home: string | null;
  /** null for Default: today's Electron userData resolution runs unchanged. */
  readonly userDataPath: string | null;
}

export type ProfileLaunch = OpenLaunch | PickerLaunch;

export type LaunchIntentTarget =
  | { readonly kind: "picker" }
  | { readonly kind: "profile"; readonly profileId: ProfileId; readonly unlocked: boolean };

/** Used only in the picker process. */
export class ProfileService extends Context.Service<
  ProfileService,
  {
    /** Default first, then by createdAt. Adopts restored folders (see ProfileServiceLive). */
    readonly list: Effect.Effect<ReadonlyArray<ProfileSummary>, ProfileError>;
    readonly create: (input: {
      readonly name: string;
      readonly password: string | null;
    }) => Effect.Effect<ProfileSummary, ProfileError>;
    /** password is required when the profile is locked. */
    readonly rename: (input: {
      readonly id: ProfileId;
      readonly name: string;
      readonly password: string | null;
    }) => Effect.Effect<ProfileSummary, ProfileError>;
    /** newPassword null removes the lock; currentPassword is required when locked. */
    readonly setPassword: (input: {
      readonly id: ProfileId;
      readonly currentPassword: string | null;
      readonly newPassword: string | null;
    }) => Effect.Effect<ProfileSummary, ProfileError>;
    /** Moves the home and its Electron userData to the Trash; refuses Default and a running profile. */
    readonly moveToTrash: (input: {
      readonly id: ProfileId;
      readonly password: string | null;
    }) => Effect.Effect<void, ProfileError>;
    /** Verifies, records last used, writes the launch intent, then relaunches. Returns only on failure. */
    readonly open: (input: {
      readonly id: ProfileId;
      readonly password: string | null;
    }) => Effect.Effect<void, ProfileError>;
  }
>()("@t3tools/desktop/profiles/ProfileContract/ProfileService") {}

/** Used only in a profile process (the normal app runtime). */
export class DesktopProfileSwitch extends Context.Service<
  DesktopProfileSwitch,
  {
    readonly active: ActiveProfile;
    /** Confirms with a native dialog, then relaunches into the picker. false when cancelled. */
    readonly switchToPicker: Effect.Effect<boolean>;
  }
>()("@t3tools/desktop/profiles/ProfileContract/DesktopProfileSwitch") {}

export interface ProfileServiceLiveInput {
  readonly profilesRoot: string;
  readonly defaultHome: string;
  readonly appDataDirectory: string;
  readonly isDevelopment: boolean;
  readonly now: () => Date;
  /** Electron's shell.trashItem. */
  readonly trashItem: (path: string) => Promise<void>;
  /** Called after the intent is written; must relaunch and exit the process. */
  readonly relaunch: () => void;
}

/** Exported by profile-picker.cjs; main.ts loads it with require so core never imports picker code. */
export type RunProfilePicker = (launch: PickerLaunch) => void;
