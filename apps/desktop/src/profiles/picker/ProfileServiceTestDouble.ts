import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import {
  PROFILE_NAME_MAX_LENGTH,
  PROFILE_PASSWORD_MAX_LENGTH,
  PROFILE_PASSWORD_MIN_LENGTH,
  ProfileError,
  type ProfileErrorReason,
  type ProfileId,
  ProfileService,
  type ProfileSummary,
} from "../ProfileContract.ts";

type Entry = ProfileSummary & { readonly password?: string };

export interface ProfileServiceTestDouble {
  readonly layer: Layer.Layer<ProfileService>;
  /** Every call in order; passwords are never recorded. */
  readonly calls: Ref.Ref<ReadonlyArray<{ readonly op: string; readonly id?: string }>>;
  readonly opened: Ref.Ref<ReadonlyArray<ProfileId>>;
}

const summary = ({ password: _password, ...entry }: Entry): ProfileSummary => entry;

const failWith = (reason: ProfileErrorReason, profileId?: string) =>
  Effect.fail(
    new ProfileError({
      reason,
      detail: `Test double refused: ${reason}`,
      ...(profileId === undefined ? {} : { profileId }),
    }),
  );

export const makeProfileServiceTestDouble = Effect.fn("ProfileServiceTestDouble.make")(
  function* (initial: { readonly profiles: ReadonlyArray<Entry> }) {
    const entries = yield* Ref.make<ReadonlyArray<Entry>>(initial.profiles);
    const calls = yield* Ref.make<ReadonlyArray<{ readonly op: string; readonly id?: string }>>([]);
    const opened = yield* Ref.make<ReadonlyArray<ProfileId>>([]);
    let nextId = 0;

    const record = (op: string, id?: string) =>
      Ref.update(calls, (all) => [...all, id === undefined ? { op } : { op, id }]);

    const find = (id: ProfileId) =>
      Effect.flatMap(Ref.get(entries), (all) => {
        const entry = all.find((candidate) => candidate.id === id);
        return entry === undefined ? failWith("NotFound", id) : Effect.succeed(entry);
      });

    const verify = (entry: Entry, password: string | null) => {
      if (entry.password === undefined) return Effect.void;
      if (password === null) return failWith("PasswordRequired", entry.id);
      return password === entry.password ? Effect.void : failWith("WrongPassword", entry.id);
    };

    const validName = (raw: string, exceptId: ProfileId | null) =>
      Effect.flatMap(Ref.get(entries), (all) => {
        const name = raw.trim();
        if (name.length === 0 || name.length > PROFILE_NAME_MAX_LENGTH) {
          return failWith("InvalidName");
        }
        const duplicate = all.some(
          (entry) => entry.id !== exceptId && entry.name?.toLowerCase() === name.toLowerCase(),
        );
        return duplicate ? failWith("DuplicateName") : Effect.succeed(name);
      });

    const validPassword = (password: string | null) =>
      password === null ||
      (password.length >= PROFILE_PASSWORD_MIN_LENGTH &&
        password.length <= PROFILE_PASSWORD_MAX_LENGTH)
        ? Effect.void
        : failWith("InvalidPassword");

    const replace = (next: Entry) =>
      Ref.update(entries, (all) => all.map((entry) => (entry.id === next.id ? next : entry))).pipe(
        Effect.as(summary(next)),
      );

    const withLock = (entry: Entry, password: string | null): Entry => {
      const { password: _old, ...rest } = entry;
      return password === null ? { ...rest, locked: false } : { ...rest, locked: true, password };
    };

    const service = ProfileService.of({
      list: record("list").pipe(
        Effect.andThen(Ref.get(entries)),
        Effect.map((all) => all.map(summary)),
      ),
      create: Effect.fn("ProfileServiceTestDouble.create")(function* ({ name, password }) {
        yield* record("create");
        const validated = yield* validName(name, null);
        yield* validPassword(password);
        nextId += 1;
        const entry = withLock(
          {
            id: `p${String(nextId).padStart(10, "0")}` as ProfileId,
            name: validated,
            isDefault: false,
            locked: false,
            lastUsed: false,
          },
          password,
        );
        yield* Ref.update(entries, (all) => [...all, entry]);
        return summary(entry);
      }),
      rename: Effect.fn("ProfileServiceTestDouble.rename")(function* ({ id, name, password }) {
        yield* record("rename", id);
        const entry = yield* find(id);
        yield* verify(entry, password);
        return yield* replace({ ...entry, name: yield* validName(name, id) });
      }),
      setPassword: Effect.fn("ProfileServiceTestDouble.setPassword")(function* ({
        id,
        currentPassword,
        newPassword,
      }) {
        yield* record("setPassword", id);
        const entry = yield* find(id);
        yield* verify(entry, currentPassword);
        yield* validPassword(newPassword);
        return yield* replace(withLock(entry, newPassword));
      }),
      moveToTrash: Effect.fn("ProfileServiceTestDouble.moveToTrash")(function* ({ id, password }) {
        yield* record("moveToTrash", id);
        const entry = yield* find(id);
        if (entry.isDefault) return yield* failWith("DefaultProfileProtected", id);
        yield* verify(entry, password);
        yield* Ref.update(entries, (all) => all.filter((candidate) => candidate.id !== id));
      }),
      open: Effect.fn("ProfileServiceTestDouble.open")(function* ({ id, password }) {
        yield* record("open", id);
        const entry = yield* find(id);
        yield* verify(entry, password);
        yield* Ref.update(entries, (all) =>
          all.map((candidate) => ({ ...candidate, lastUsed: candidate.id === id })),
        );
        yield* Ref.update(opened, (all) => [...all, id]);
      }),
    });

    return {
      layer: Layer.succeed(ProfileService, service),
      calls,
      opened,
    } satisfies ProfileServiceTestDouble;
  },
);
