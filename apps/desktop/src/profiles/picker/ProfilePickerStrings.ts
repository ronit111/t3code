import { msg } from "gt-i18n";

import { m } from "../../i18n/messages.ts";
import type { PickerNotice, ProfileErrorReason } from "../ProfileContract.ts";

export const pickerStrings = (notice: PickerNotice) => ({
  windowTitle: m(msg("Choose a profile")),
  heading: m(msg("Choose a profile")),
  defaultName: m(msg("Default", { $context: "name of the default profile" })),
  lastUsed: m(msg("Last used", { $context: "tag on the profile opened most recently" })),
  locked: m(msg("Locked", { $context: "the profile needs a password to open" })),
  addProfile: m(msg("Add profile")),
  more: m(msg("More actions", { $context: "button, opens a profile's actions" })),
  rename: m(msg("Rename...")),
  setPassword: m(msg("Set password...")),
  changePassword: m(msg("Change password...")),
  removePassword: m(msg("Remove password...")),
  moveToTrash: m(msg("Move to Trash...")),
  open: m(msg("Open", { $context: "button, opens a profile" })),
  cancel: m(msg("Cancel")),
  save: m(msg("Save")),
  add: m(msg("Add", { $context: "button, adds a profile" })),
  remove: m(msg("Remove", { $context: "button, removes a profile's password" })),
  continue: m(msg("Continue")),
  addTitle: m(msg("Add a profile")),
  renameTitle: m(msg("Rename profile")),
  setPasswordTitle: m(msg("Set a password")),
  changePasswordTitle: m(msg("Change password")),
  removePasswordTitle: m(msg("Remove password")),
  moveToTrashTitle: m(msg("Move to Trash")),
  moveToTrashHint: m(msg("Enter the password to move this profile to the Trash.")),
  nameLabel: m(msg("Name")),
  passwordLabel: m(msg("Password")),
  passwordOptionalLabel: m(msg("Password (optional)")),
  confirmPasswordLabel: m(msg("Confirm password")),
  currentPasswordLabel: m(msg("Current password")),
  newPasswordLabel: m(msg("New password")),
  lockHint: m(
    msg(
      "A password stops others from opening this profile in T3 Code. It does not encrypt the profile's files.",
    ),
  ),
  notFound: m(msg("That profile no longer exists.")),
  registryUnreadable:
    notice._tag === "RegistryUnreadable"
      ? m(
          msg(
            "T3 Code can't read the profiles file at {path}. Fix or remove the file, then open T3 Code again.",
          ),
          { path: notice.registryPath },
        )
      : "",
  showFile: m(msg("Show file")),
  quit: m(msg("Quit")),
  nameRequired: m(msg("Enter a name.")),
  nameTooLong: m(msg("Use 40 characters or fewer.")),
  passwordTooShort: m(msg("Use at least 4 characters.")),
  passwordTooLong: m(msg("Use 256 characters or fewer.")),
  passwordMismatch: m(msg("The passwords don't match.")),
  passwordRequired: m(msg("Enter the password.")),
  unexpectedError: m(msg("Something went wrong. Try again.")),
});
export type PickerStrings = ReturnType<typeof pickerStrings>;

export const pickerErrorMessage = (reason: ProfileErrorReason, detail: string): string => {
  switch (reason) {
    case "NotFound":
      return m(msg("That profile no longer exists."));
    case "WrongPassword":
      return m(msg("Wrong password."));
    case "PasswordRequired":
      return m(msg("Enter the password."));
    case "InvalidPassword":
      return m(msg("Use a password of 4 to 256 characters."));
    case "InvalidName":
      return m(msg("Use a name of 1 to 40 characters."));
    case "DuplicateName":
      return m(msg("Another profile already has this name."));
    case "DefaultProfileProtected":
      return m(msg("The Default profile can't be moved to the Trash."));
    case "ProfileInUse":
      return m(msg("This profile is open in T3 Code. Quit it there first."));
    case "RegistryUnreadable":
      return m(msg("T3 Code can't read the profiles file."));
    case "Io":
      return m(msg("T3 Code couldn't save the change: {detail}"), { detail });
  }
};

export const moveToTrashDialog = (name: string, root: string) => ({
  message: m(
    msg(
      "Move “{name}” to the Trash? Its chats, settings and sign-ins move with it. Put the folder back in {root} to restore it.",
    ),
    { name, root },
  ),
  confirm: m(msg("Move to Trash", { $context: "button, confirms moving a profile to the Trash" })),
  cancel: m(msg("Cancel")),
});
