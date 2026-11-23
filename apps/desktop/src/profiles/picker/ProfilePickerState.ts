import type { ProfileErrorReason, ProfileId, ProfileSummary } from "../ProfileContract.ts";
import type { PickerState } from "./ProfilePickerProtocol.ts";
import type { PickerStrings } from "./ProfilePickerStrings.ts";

// The sandboxed preload bundles this file, so it may import types only.
const NAME_MAX_LENGTH = 40;
const PASSWORD_MIN_LENGTH = 4;
const PASSWORD_MAX_LENGTH = 256;

export type FieldName = "name" | "password" | "confirmPassword" | "currentPassword" | "newPassword";
export type Fields = Readonly<Partial<Record<FieldName, string>>>;

export type Screen =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "List" }
  | { readonly _tag: "Blocked" }
  | { readonly _tag: "Add" }
  | { readonly _tag: "Rename"; readonly id: ProfileId }
  | { readonly _tag: "SetPassword"; readonly id: ProfileId }
  | { readonly _tag: "RemovePassword"; readonly id: ProfileId }
  | { readonly _tag: "MoveToTrash"; readonly id: ProfileId };

export interface FieldError {
  readonly field: FieldName | null;
  readonly message: string;
}

export interface ViewState {
  readonly screen: Screen;
  readonly strings: PickerStrings | null;
  readonly profiles: ReadonlyArray<ProfileSummary>;
  readonly notFoundBanner: boolean;
  readonly focusedId: ProfileId | null;
  /** The locked row whose inline password field is open. */
  readonly unlockingId: ProfileId | null;
  readonly menuId: ProfileId | null;
  readonly fields: Fields;
  readonly error: FieldError | null;
  readonly busy: boolean;
}

export type Command =
  | { readonly op: "open"; readonly id: ProfileId; readonly password: string | null }
  | { readonly op: "create"; readonly name: string; readonly password: string | null }
  | {
      readonly op: "rename";
      readonly id: ProfileId;
      readonly name: string;
      readonly password: string | null;
    }
  | {
      readonly op: "setPassword";
      readonly id: ProfileId;
      readonly currentPassword: string | null;
      readonly newPassword: string | null;
    }
  | { readonly op: "moveToTrash"; readonly id: ProfileId; readonly password: string | null }
  | { readonly op: "refresh"; readonly focusId: ProfileId | null }
  | { readonly op: "revealRegistry" }
  | { readonly op: "quit" };

export type PickerEvent =
  | { readonly _tag: "Loaded"; readonly state: PickerState }
  | {
      readonly _tag: "Refreshed";
      readonly profiles: ReadonlyArray<ProfileSummary>;
      readonly focusId: ProfileId | null;
    }
  | { readonly _tag: "RowClicked"; readonly id: ProfileId }
  | { readonly _tag: "SubmitUnlock"; readonly id: ProfileId; readonly password: string }
  | { readonly _tag: "ToggleMenu"; readonly id: ProfileId }
  | { readonly _tag: "StartAdd" }
  | { readonly _tag: "StartRename"; readonly id: ProfileId }
  | { readonly _tag: "StartSetPassword"; readonly id: ProfileId }
  | { readonly _tag: "StartRemovePassword"; readonly id: ProfileId }
  | { readonly _tag: "StartMoveToTrash"; readonly id: ProfileId }
  | { readonly _tag: "Cancel" }
  | { readonly _tag: "Submit"; readonly fields: Fields }
  | { readonly _tag: "Succeeded"; readonly focusId: ProfileId | null }
  | { readonly _tag: "TrashCancelled" }
  | { readonly _tag: "Failed"; readonly reason: ProfileErrorReason; readonly message: string }
  | { readonly _tag: "RevealRegistry" }
  | { readonly _tag: "Quit" };

export const initialViewState: ViewState = {
  screen: { _tag: "Loading" },
  strings: null,
  profiles: [],
  notFoundBanner: false,
  focusedId: null,
  unlockingId: null,
  menuId: null,
  fields: {},
  error: null,
  busy: false,
};

type Update = readonly [ViewState, Command | null];

const findProfile = (state: ViewState, id: ProfileId) =>
  state.profiles.find((profile) => profile.id === id);

const defaultFocus = (profiles: ReadonlyArray<ProfileSummary>): ProfileId | null =>
  (profiles.find((profile) => profile.lastUsed) ?? profiles[0])?.id ?? null;

const toList = (state: ViewState, focusedId: ProfileId | null = state.focusedId): ViewState => ({
  ...state,
  screen: { _tag: "List" },
  focusedId,
  unlockingId: null,
  menuId: null,
  fields: {},
  error: null,
  busy: false,
});

const startForm = (state: ViewState, screen: Screen): Update => [
  { ...state, screen, menuId: null, unlockingId: null, fields: {}, error: null },
  null,
];

const fail = (state: ViewState, field: FieldName | null, message: string): Update => [
  { ...state, error: { field, message }, busy: false },
  null,
];

const nameError = (strings: PickerStrings, name: string): string | null => {
  if (name.length === 0) return strings.nameRequired;
  if (name.length > NAME_MAX_LENGTH) return strings.nameTooLong;
  return null;
};

const passwordError = (strings: PickerStrings, password: string): string | null => {
  if (password.length === 0) return strings.passwordRequired;
  if (password.length < PASSWORD_MIN_LENGTH) return strings.passwordTooShort;
  if (password.length > PASSWORD_MAX_LENGTH) return strings.passwordTooLong;
  return null;
};

/** The field a service error belongs to on the current screen; null shows it under the form. */
const errorField = (screen: Screen, reason: ProfileErrorReason): FieldName | null => {
  switch (reason) {
    case "InvalidName":
    case "DuplicateName":
      return screen._tag === "Add" || screen._tag === "Rename" ? "name" : null;
    case "InvalidPassword":
      if (screen._tag === "Add") return "password";
      return screen._tag === "SetPassword" ? "newPassword" : null;
    case "WrongPassword":
    case "PasswordRequired":
      if (screen._tag === "SetPassword" || screen._tag === "RemovePassword") {
        return "currentPassword";
      }
      return screen._tag === "Add" ? null : "password";
    default:
      return null;
  }
};

const submitForm = (state: ViewState, strings: PickerStrings, fields: Fields): Update => {
  const screen = state.screen;
  const withFields: ViewState = { ...state, fields };
  const password = fields.password ?? "";
  const currentPassword = fields.currentPassword ?? "";
  const busy = (command: Command): Update => [{ ...withFields, error: null, busy: true }, command];
  switch (screen._tag) {
    case "Add": {
      const name = (fields.name ?? "").trim();
      const invalidName = nameError(strings, name);
      if (invalidName !== null) return fail(withFields, "name", invalidName);
      if (password.length > 0) {
        const invalidPassword = passwordError(strings, password);
        if (invalidPassword !== null) return fail(withFields, "password", invalidPassword);
      }
      if ((fields.confirmPassword ?? "") !== password) {
        return fail(withFields, "confirmPassword", strings.passwordMismatch);
      }
      return busy({ op: "create", name, password: password.length > 0 ? password : null });
    }
    case "Rename": {
      const name = (fields.name ?? "").trim();
      const invalidName = nameError(strings, name);
      if (invalidName !== null) return fail(withFields, "name", invalidName);
      const locked = findProfile(state, screen.id)?.locked === true;
      if (locked && password.length === 0) {
        return fail(withFields, "password", strings.passwordRequired);
      }
      return busy({ op: "rename", id: screen.id, name, password: locked ? password : null });
    }
    case "SetPassword": {
      const locked = findProfile(state, screen.id)?.locked === true;
      if (locked && currentPassword.length === 0) {
        return fail(withFields, "currentPassword", strings.passwordRequired);
      }
      const newPassword = fields.newPassword ?? "";
      const invalidPassword = passwordError(strings, newPassword);
      if (invalidPassword !== null) return fail(withFields, "newPassword", invalidPassword);
      if ((fields.confirmPassword ?? "") !== newPassword) {
        return fail(withFields, "confirmPassword", strings.passwordMismatch);
      }
      return busy({
        op: "setPassword",
        id: screen.id,
        currentPassword: locked ? currentPassword : null,
        newPassword,
      });
    }
    case "RemovePassword":
      if (currentPassword.length === 0) {
        return fail(withFields, "currentPassword", strings.passwordRequired);
      }
      return busy({ op: "setPassword", id: screen.id, currentPassword, newPassword: null });
    case "MoveToTrash":
      if (password.length === 0) return fail(withFields, "password", strings.passwordRequired);
      return busy({ op: "moveToTrash", id: screen.id, password });
    default:
      return [state, null];
  }
};

export const update = (state: ViewState, event: PickerEvent): Update => {
  const strings = state.strings;
  if (event._tag === "Loaded") {
    const { notice, profiles, unlockProfileId } = event.state;
    const base: ViewState = {
      ...initialViewState,
      strings: event.state.strings as PickerStrings,
      profiles,
    };
    if (notice._tag === "RegistryUnreadable") {
      return [{ ...base, screen: { _tag: "Blocked" } }, null];
    }
    const unlocking = profiles.some((profile) => profile.id === unlockProfileId)
      ? unlockProfileId
      : null;
    return [
      {
        ...base,
        screen: { _tag: "List" },
        notFoundBanner: notice._tag === "ProfileNotFound",
        focusedId: unlocking ?? defaultFocus(profiles),
        unlockingId: unlocking,
      },
      null,
    ];
  }
  if (strings === null) return [state, null];
  if (state.screen._tag === "Blocked") {
    if (event._tag === "RevealRegistry") return [state, { op: "revealRegistry" }];
    if (event._tag === "Quit") return [state, { op: "quit" }];
    return [state, null];
  }
  if (event._tag === "Quit") return [state, { op: "quit" }];
  const settles =
    event._tag === "Succeeded" ||
    event._tag === "Failed" ||
    event._tag === "Refreshed" ||
    event._tag === "TrashCancelled";
  if (state.busy && !settles) return [state, null];

  switch (event._tag) {
    case "Refreshed": {
      const focusId = event.profiles.some((profile) => profile.id === event.focusId)
        ? event.focusId
        : defaultFocus(event.profiles);
      return [toList({ ...state, profiles: event.profiles }, focusId), null];
    }
    case "RowClicked": {
      const profile = findProfile(state, event.id);
      if (profile === undefined) return [state, null];
      if (profile.locked) {
        return [
          {
            ...state,
            focusedId: profile.id,
            unlockingId: profile.id,
            menuId: null,
            fields: {},
            error: state.unlockingId === profile.id ? state.error : null,
          },
          null,
        ];
      }
      return [
        {
          ...state,
          focusedId: profile.id,
          unlockingId: null,
          menuId: null,
          error: null,
          busy: true,
        },
        { op: "open", id: profile.id, password: null },
      ];
    }
    case "SubmitUnlock": {
      if (event.password.length === 0) {
        return fail(
          { ...state, unlockingId: event.id, fields: {} },
          "password",
          strings.passwordRequired,
        );
      }
      return [
        {
          ...state,
          unlockingId: event.id,
          fields: { password: event.password },
          error: null,
          busy: true,
        },
        { op: "open", id: event.id, password: event.password },
      ];
    }
    case "ToggleMenu":
      return [{ ...state, menuId: state.menuId === event.id ? null : event.id }, null];
    case "StartAdd":
      return startForm(state, { _tag: "Add" });
    case "StartRename": {
      const profile = findProfile(state, event.id);
      if (profile === undefined) return [state, null];
      const [next] = startForm(state, { _tag: "Rename", id: event.id });
      return [{ ...next, fields: { name: profile.name ?? strings.defaultName } }, null];
    }
    case "StartSetPassword":
      return startForm(state, { _tag: "SetPassword", id: event.id });
    case "StartRemovePassword":
      return findProfile(state, event.id)?.locked === true
        ? startForm(state, { _tag: "RemovePassword", id: event.id })
        : [state, null];
    case "StartMoveToTrash": {
      const profile = findProfile(state, event.id);
      if (profile === undefined || profile.isDefault) return [state, null];
      if (profile.locked) return startForm(state, { _tag: "MoveToTrash", id: event.id });
      return [
        { ...state, menuId: null, error: null, busy: true },
        { op: "moveToTrash", id: event.id, password: null },
      ];
    }
    case "Cancel":
      return [toList(state), null];
    case "Submit":
      return submitForm(state, strings, event.fields);
    case "Succeeded":
      return [
        { ...state, busy: true },
        { op: "refresh", focusId: event.focusId },
      ];
    case "TrashCancelled":
      return [toList(state), null];
    case "Failed": {
      const field = errorField(state.screen, event.reason);
      const clearsPassword = event.reason === "WrongPassword" && field !== null;
      const fields = clearsPassword ? { ...state.fields, [field]: "" } : state.fields;
      return fail({ ...state, fields }, field, event.message);
    }
    case "RevealRegistry":
      return [state, null];
  }
};
