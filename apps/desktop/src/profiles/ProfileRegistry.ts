import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import { msg } from "gt-i18n";

import { m } from "../i18n/messages.ts";
import {
  DEFAULT_PROFILE_ID,
  PROFILE_ID_PATTERN,
  PROFILE_NAME_MAX_LENGTH,
  ProfileError,
  ProfileId,
} from "./ProfileContract.ts";
import { profileMirrorPath, registryPath } from "./ProfilePaths.ts";

export const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));
const IsoDateString = Schema.String.check(
  Schema.makeFilter((value: string) => !Number.isNaN(Date.parse(value))),
);

export const ProfileLockRecord = Schema.Struct({
  kdf: Schema.Literal("scrypt"),
  N: PositiveInt,
  r: PositiveInt,
  p: PositiveInt,
  keyLength: PositiveInt,
  salt: Schema.String,
  hash: Schema.String,
});
export type ProfileLockRecord = typeof ProfileLockRecord.Type;

export const ProfileEntry = Schema.Struct({
  id: ProfileId,
  name: Schema.NullOr(Schema.String),
  createdAt: IsoDateString,
  lock: Schema.NullOr(ProfileLockRecord),
});
export type ProfileEntry = typeof ProfileEntry.Type;

const RegistryDocument = Schema.Struct({
  version: Schema.Literal(1),
  profiles: Schema.Array(ProfileEntry),
  lastUsedProfileId: Schema.optionalKey(ProfileId),
});
export type ProfileRegistry = typeof RegistryDocument.Type;

export const defaultProfileId: ProfileId = Schema.decodeSync(ProfileId)(DEFAULT_PROFILE_ID);

const SYNTHESIZED_DEFAULT_CREATED_AT = "1970-01-01T00:00:00.000Z";

export const emptyRegistry = (): ProfileRegistry => ({
  version: 1,
  profiles: [
    { id: defaultProfileId, name: null, createdAt: SYNTHESIZED_DEFAULT_CREATED_AT, lock: null },
  ],
});

export const normalizeProfileName = (name: string): string => name.trim();

export const isValidProfileName = (name: string): boolean =>
  name.length >= 1 && name.length <= PROFILE_NAME_MAX_LENGTH && name === name.trim();

export const isNameTaken = (
  registry: ProfileRegistry,
  name: string,
  exceptId: ProfileId | null = null,
): boolean =>
  registry.profiles.some(
    (entry) =>
      entry.id !== exceptId &&
      entry.name !== null &&
      entry.name.toLowerCase() === name.toLowerCase(),
  );

/** The Schema rules a struct cannot express: one Default first, unique ids and names. */
const normalizeRegistry = (document: ProfileRegistry): Option.Option<ProfileRegistry> => {
  const defaults = document.profiles.filter((entry) => entry.id === DEFAULT_PROFILE_ID);
  if (defaults.length > 1) return Option.none();
  const profiles =
    defaults.length === 0 ? [...emptyRegistry().profiles, ...document.profiles] : document.profiles;
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const entry of profiles) {
    if (ids.has(entry.id)) return Option.none();
    ids.add(entry.id);
    if (entry.name === null) {
      if (entry.id !== DEFAULT_PROFILE_ID) return Option.none();
      continue;
    }
    if (!isValidProfileName(entry.name)) return Option.none();
    const key = entry.name.toLowerCase();
    if (names.has(key)) return Option.none();
    names.add(key);
  }
  return Option.some({ ...document, version: 1, profiles });
};

const decodeRegistryDocument = Schema.decodeUnknownOption(Schema.fromJsonString(RegistryDocument));
const encodeRegistryDocument = Schema.encodeSync(
  Schema.fromJsonString(RegistryDocument, { space: 2 }),
);
const decodeEntryText = Schema.decodeUnknownOption(Schema.fromJsonString(ProfileEntry));
const encodeEntryText = Schema.encodeSync(Schema.fromJsonString(ProfileEntry, { space: 2 }));

/** Sync, so the launch decision can run before Electron is ready. */
export const decodeRegistryText = (text: string): Option.Option<ProfileRegistry> =>
  decodeRegistryDocument(text).pipe(Option.flatMap(normalizeRegistry));

export const encodeRegistryText = (registry: ProfileRegistry): string =>
  `${encodeRegistryDocument({ ...registry, version: 1 })}\n`;

export const ioError = (detail: string, profileId?: string) =>
  new ProfileError({
    reason: "Io",
    detail,
    ...(profileId === undefined ? {} : { profileId }),
  });

/** Writes through a sibling temp file and a rename, so readers never see half a file. */
export const writeFileAtomic = Effect.fn("DesktopProfiles.writeFileAtomic")(function* (
  filePath: string,
  content: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(filePath), {
    recursive: true,
    mode: PRIVATE_DIRECTORY_MODE,
  });
  const suffix = yield* Random.nextIntBetween(0, 0xffffff);
  const temporaryPath = `${filePath}.${process.pid}.${suffix.toString(36)}.tmp`;
  yield* fs.writeFileString(temporaryPath, content, { mode: PRIVATE_FILE_MODE, flag: "wx" });
  yield* fs.chmod(temporaryPath, PRIVATE_FILE_MODE);
  yield* fs
    .rename(temporaryPath, filePath)
    .pipe(Effect.tapError(() => fs.remove(temporaryPath).pipe(Effect.ignore)));
});

/** None when the file is missing; RegistryUnreadable when it exists but does not decode. */
export const readRegistry = Effect.fn("DesktopProfiles.readRegistry")(function* (
  profilesRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filePath = registryPath(profilesRoot, path.join);
  const unreadable = () =>
    new ProfileError({
      reason: "RegistryUnreadable",
      detail: m(msg("T3 Code can't read the profiles file at {path}."), { path: filePath }),
    });
  if (!(yield* fs.exists(filePath).pipe(Effect.mapError(unreadable)))) {
    return Option.none<ProfileRegistry>();
  }
  const text = yield* fs.readFileString(filePath).pipe(Effect.mapError(unreadable));
  return Option.some(
    yield* Effect.fromOption(decodeRegistryText(text)).pipe(Effect.mapError(unreadable)),
  );
});

export const writeRegistry = Effect.fn("DesktopProfiles.writeRegistry")(
  function* (profilesRoot: string, registry: ProfileRegistry) {
    const path = yield* Path.Path;
    yield* writeFileAtomic(registryPath(profilesRoot, path.join), encodeRegistryText(registry));
  },
  Effect.mapError(() => ioError(m(msg("T3 Code could not save the profiles file.")))),
);

export const writeProfileMirror = Effect.fn("DesktopProfiles.writeProfileMirror")(
  function* (profilesRoot: string, entry: ProfileEntry) {
    const path = yield* Path.Path;
    yield* writeFileAtomic(
      profileMirrorPath(profilesRoot, entry.id, path.join),
      `${encodeEntryText(entry)}\n`,
    );
  },
  (effect, _profilesRoot, entry) =>
    effect.pipe(
      Effect.mapError(() =>
        ioError(m(msg("T3 Code could not save this profile's details.")), entry.id),
      ),
    ),
);

const readProfileMirror = Effect.fn("DesktopProfiles.readProfileMirror")(function* (
  profilesRoot: string,
  id: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fs
    .readFileString(profileMirrorPath(profilesRoot, id, path.join))
    .pipe(Effect.option);
  return Option.flatMap(text, decodeEntryText).pipe(
    Option.filter((entry) => entry.id === id && entry.name !== null),
  );
});

const restoredName = (registry: ProfileRegistry, name: string): string => {
  let candidate = name;
  for (let attempt = 1; isNameTaken(registry, candidate); attempt += 1) {
    const suffix = attempt === 1 ? " (restored)" : ` (restored ${attempt})`;
    candidate = `${name.slice(0, PROFILE_NAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
  }
  return candidate;
};

/**
 * Adds back every `<root>/<id>` folder whose `profile.json` names it and that the registry lacks.
 * This is how a profile comes back from the Trash, and how a create that crashed before its
 * registry write shows up.
 */
export const adoptOrphanProfiles = Effect.fn("DesktopProfiles.adoptOrphanProfiles")(function* (
  profilesRoot: string,
  registry: ProfileRegistry,
) {
  const fs = yield* FileSystem.FileSystem;
  const names = yield* fs.readDirectory(profilesRoot).pipe(Effect.orElseSucceed(() => []));
  const profiles = [...registry.profiles];
  const adopted: Array<ProfileEntry> = [];
  for (const name of [...names].sort()) {
    if (name === DEFAULT_PROFILE_ID || !PROFILE_ID_PATTERN.test(name)) continue;
    if (profiles.some((entry) => entry.id === name)) continue;
    const mirror = yield* readProfileMirror(profilesRoot, name);
    if (Option.isNone(mirror) || mirror.value.name === null) continue;
    const entry = {
      ...mirror.value,
      name: restoredName({ ...registry, profiles }, mirror.value.name),
    };
    profiles.push(entry);
    adopted.push(entry);
  }
  return { registry: { ...registry, profiles }, adopted } as const;
});
