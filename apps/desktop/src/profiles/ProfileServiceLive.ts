// @effect-diagnostics nodeBuiltinImport:off - Profile ids need node:crypto randomness; Effect's Random is not cryptographic.
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { msg } from "gt-i18n";

import { isStateDirOwned } from "../backend/DesktopHomeOwner.ts";
import { m } from "../i18n/messages.ts";
import {
  DEFAULT_PROFILE_ID,
  PROFILE_PASSWORD_MAX_LENGTH,
  PROFILE_PASSWORD_MIN_LENGTH,
  ProfileError,
  ProfileId,
  ProfileService,
  type ProfileServiceLiveInput,
  type ProfileSummary,
} from "./ProfileContract.ts";
import { writeLaunchIntent } from "./ProfileLaunch.ts";
import { hashPassword, verifyPassword } from "./ProfileLock.ts";
import { profileHome, profileUserDataPath, seededSettingsPath } from "./ProfilePaths.ts";
import {
  adoptOrphanProfiles,
  emptyRegistry,
  ioError,
  isNameTaken,
  isValidProfileName,
  normalizeProfileName,
  readRegistry,
  writeProfileMirror,
  writeRegistry,
  type ProfileEntry,
  type ProfileRegistry,
} from "./ProfileRegistry.ts";
import { seedProfileHome } from "./ProfileSeed.ts";

const WRONG_PASSWORD_DELAY = "1 second";
const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const decodeProfileId = Schema.decodeSync(ProfileId);

const randomProfileId = (): ProfileId => {
  let suffix = "";
  for (let index = 0; index < 10; index += 1) {
    suffix += ID_ALPHABET[NodeCrypto.randomInt(ID_ALPHABET.length)];
  }
  return decodeProfileId(`p${suffix}`);
};

const profileError = (
  reason: ProfileError["reason"],
  detail: string,
  profileId?: string,
): ProfileError =>
  new ProfileError({ reason, detail, ...(profileId === undefined ? {} : { profileId }) });

const summarize = (registry: ProfileRegistry, entry: ProfileEntry): ProfileSummary => ({
  id: entry.id,
  name: entry.name,
  isDefault: entry.id === DEFAULT_PROFILE_ID,
  locked: entry.lock !== null,
  lastUsed: registry.lastUsedProfileId === entry.id,
});

const byListOrder = (left: ProfileEntry, right: ProfileEntry) => {
  if (left.id === DEFAULT_PROFILE_ID) return -1;
  if (right.id === DEFAULT_PROFILE_ID) return 1;
  return Date.parse(left.createdAt) - Date.parse(right.createdAt);
};

const validateName = (raw: string) => {
  const name = normalizeProfileName(raw);
  return isValidProfileName(name)
    ? Effect.succeed(name)
    : Effect.fail(profileError("InvalidName", m(msg("Use a name of 1 to 40 characters."))));
};

const validatePassword = (password: string) =>
  password.length >= PROFILE_PASSWORD_MIN_LENGTH && password.length <= PROFILE_PASSWORD_MAX_LENGTH
    ? Effect.void
    : Effect.fail(
        profileError("InvalidPassword", m(msg("Use a password of 4 to 256 characters."))),
      );

const make = Effect.fn("DesktopProfiles.makeProfileService")(function* (
  input: ProfileServiceLiveInput,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = input.profilesRoot;
  const writes = yield* Semaphore.make(1);
  const provide = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const load = provide(readRegistry(root)).pipe(
    Effect.map((registry) => ({
      registry: Option.getOrElse(registry, emptyRegistry),
      exists: Option.isSome(registry),
    })),
  );

  const findEntry = (registry: ProfileRegistry, id: ProfileId) => {
    const entry = registry.profiles.find((candidate) => candidate.id === id);
    return entry === undefined
      ? Effect.fail(profileError("NotFound", m(msg("That profile no longer exists.")), id))
      : Effect.succeed(entry);
  };

  const requireUnlocked = Effect.fn("DesktopProfiles.requireUnlocked")(function* (
    entry: ProfileEntry,
    password: string | null,
  ) {
    if (entry.lock === null) return;
    if (password === null) {
      return yield* profileError(
        "PasswordRequired",
        m(msg("Enter this profile's password.")),
        entry.id,
      );
    }
    if (yield* verifyPassword(password, entry.lock)) return;
    yield* Effect.sleep(WRONG_PASSWORD_DELAY);
    return yield* profileError("WrongPassword", m(msg("That password is not right.")), entry.id);
  });

  const save = Effect.fn("DesktopProfiles.save")(function* (
    registry: ProfileRegistry,
    changed: ProfileEntry | null,
  ) {
    if (changed !== null && changed.id !== DEFAULT_PROFILE_ID) {
      yield* provide(writeProfileMirror(root, changed));
    }
    yield* provide(writeRegistry(root, registry));
  });

  const replaceEntry = (registry: ProfileRegistry, entry: ProfileEntry): ProfileRegistry => ({
    ...registry,
    profiles: registry.profiles.map((candidate) => (candidate.id === entry.id ? entry : candidate)),
  });

  const list: ProfileService["Service"]["list"] = Effect.gen(function* () {
    const loaded = yield* load;
    const { registry, adopted } = yield* provide(adoptOrphanProfiles(root, loaded.registry));
    if (adopted.length > 0) yield* save(registry, null);
    return [...registry.profiles].sort(byListOrder).map((entry) => summarize(registry, entry));
  }).pipe(writes.withPermits(1), Effect.withSpan("DesktopProfiles.list"));

  const freshProfileId = Effect.gen(function* () {
    for (;;) {
      const id = randomProfileId();
      const taken = yield* fs
        .exists(profileHome(root, id, path.join))
        .pipe(
          Effect.mapError(() => ioError(m(msg("T3 Code could not read the profiles folder.")))),
        );
      if (!taken) return id;
    }
  });

  const create: ProfileService["Service"]["create"] = Effect.fn("DesktopProfiles.create")(
    function* (request) {
      const name = yield* validateName(request.name);
      if (request.password !== null) yield* validatePassword(request.password);
      const { registry } = yield* load;
      if (isNameTaken(registry, name)) {
        return yield* profileError(
          "DuplicateName",
          m(msg("Another profile already has that name.")),
        );
      }
      const id = yield* freshProfileId;
      const entry: ProfileEntry = {
        id,
        name,
        createdAt: input.now().toISOString(),
        lock: request.password === null ? null : yield* hashPassword(request.password),
      };
      yield* provide(seedProfileHome(root, entry));
      const next = { ...registry, profiles: [...registry.profiles, entry] };
      yield* provide(writeRegistry(root, next));
      return summarize(next, entry);
    },
    (effect) => writes.withPermits(1)(effect),
  );

  const rename: ProfileService["Service"]["rename"] = Effect.fn("DesktopProfiles.rename")(
    function* (request) {
      const { registry } = yield* load;
      const entry = yield* findEntry(registry, request.id);
      yield* requireUnlocked(entry, request.password);
      const name = yield* validateName(request.name);
      if (isNameTaken(registry, name, entry.id)) {
        return yield* profileError(
          "DuplicateName",
          m(msg("Another profile already has that name.")),
          entry.id,
        );
      }
      const renamed = { ...entry, name };
      const next = replaceEntry(registry, renamed);
      yield* save(next, renamed);
      return summarize(next, renamed);
    },
    (effect) => writes.withPermits(1)(effect),
  );

  const setPassword: ProfileService["Service"]["setPassword"] = Effect.fn(
    "DesktopProfiles.setPassword",
  )(
    function* (request) {
      const { registry } = yield* load;
      const entry = yield* findEntry(registry, request.id);
      yield* requireUnlocked(entry, request.currentPassword);
      if (request.newPassword !== null) yield* validatePassword(request.newPassword);
      const updated = {
        ...entry,
        lock: request.newPassword === null ? null : yield* hashPassword(request.newPassword),
      };
      const next = replaceEntry(registry, updated);
      yield* save(next, updated);
      return summarize(next, updated);
    },
    (effect) => writes.withPermits(1)(effect),
  );

  const trash = (target: string, id: ProfileId) =>
    Effect.tryPromise({
      try: () => input.trashItem(target),
      catch: () => ioError(m(msg("T3 Code could not move the profile to the Trash.")), id),
    });

  const moveToTrash: ProfileService["Service"]["moveToTrash"] = Effect.fn(
    "DesktopProfiles.moveToTrash",
  )(
    function* (request) {
      if (request.id === DEFAULT_PROFILE_ID) {
        return yield* profileError(
          "DefaultProfileProtected",
          m(msg("The Default profile can't be moved to the Trash.")),
          request.id,
        );
      }
      const { registry } = yield* load;
      const entry = yield* findEntry(registry, request.id);
      yield* requireUnlocked(entry, request.password);
      const home = profileHome(root, entry.id, path.join);
      if (yield* provide(isStateDirOwned(path.join(home, "userdata")))) {
        return yield* profileError(
          "ProfileInUse",
          m(msg("This profile is open. Quit it first, then try again.")),
          entry.id,
        );
      }
      const { lastUsedProfileId, ...rest } = registry;
      // Registry first: if the Trash step fails, the folder stays and the next list adopts it back.
      yield* provide(
        writeRegistry(root, {
          ...rest,
          profiles: registry.profiles.filter((candidate) => candidate.id !== entry.id),
          ...(lastUsedProfileId === undefined || lastUsedProfileId === entry.id
            ? {}
            : { lastUsedProfileId }),
        }),
      );
      yield* trash(home, entry.id);
      const userData = profileUserDataPath({
        appDataDirectory: input.appDataDirectory,
        id: entry.id,
        isDevelopment: input.isDevelopment,
        joinPath: path.join,
      });
      if (yield* fs.exists(userData).pipe(Effect.orElseSucceed(() => false))) {
        yield* trash(userData, entry.id);
      }
    },
    (effect) => writes.withPermits(1)(effect),
  );

  const open: ProfileService["Service"]["open"] = Effect.fn("DesktopProfiles.open")(
    function* (request) {
      const loaded = yield* load;
      const entry = yield* findEntry(loaded.registry, request.id);
      yield* requireUnlocked(entry, request.password);
      if (entry.id !== DEFAULT_PROFILE_ID) {
        const settings = seededSettingsPath(profileHome(root, entry.id, path.join), path.join);
        if (!(yield* fs.exists(settings).pipe(Effect.orElseSucceed(() => false)))) {
          return yield* profileError(
            "NotFound",
            m(msg("This profile's folder is missing, so T3 Code can't open it.")),
            entry.id,
          );
        }
      }
      // Opening Default from a picker reached with Default alone must not create the registry.
      if (loaded.exists) {
        yield* provide(writeRegistry(root, { ...loaded.registry, lastUsedProfileId: entry.id }));
      }
      yield* provide(
        writeLaunchIntent({
          profilesRoot: root,
          target: { kind: "profile", profileId: entry.id, unlocked: true },
          createdAt: input.now(),
        }),
      ).pipe(
        Effect.mapError(() => ioError(m(msg("T3 Code could not open this profile.")), entry.id)),
      );
      yield* Effect.sync(input.relaunch);
    },
    (effect) => writes.withPermits(1)(effect),
  );

  return ProfileService.of({ list, create, rename, setPassword, moveToTrash, open });
});

/** @public */
export const layer = (input: ProfileServiceLiveInput) => Layer.effect(ProfileService, make(input));
