import { assert, describe, it } from "@effect/vitest";

import type { ProfileId, ProfileSummary } from "../ProfileContract.ts";
import type { PickerState } from "./ProfilePickerProtocol.ts";
import { pickerStrings } from "./ProfilePickerStrings.ts";
import {
  type Command,
  type PickerEvent,
  type ViewState,
  initialViewState,
  update,
} from "./ProfilePickerState.ts";

const id = (value: string) => value as ProfileId;
const profile = (overrides: Partial<ProfileSummary> & { readonly id: ProfileId }) =>
  ({ name: "Work", isDefault: false, locked: false, lastUsed: false, ...overrides }) as const;

const profiles: ReadonlyArray<ProfileSummary> = [
  profile({ id: id("default"), name: null, isDefault: true }),
  profile({ id: id("pwork000001"), name: "Work", locked: true, lastUsed: true }),
  profile({ id: id("ppers000001"), name: "Personal" }),
];

const loaded = (overrides: Partial<PickerState> = {}): ViewState =>
  update(initialViewState, {
    _tag: "Loaded",
    state: {
      strings: pickerStrings(
        overrides.notice ?? { _tag: "None" },
      ) as unknown as PickerState["strings"],
      profiles,
      unlockProfileId: null,
      notice: { _tag: "None" },
      ...overrides,
    },
  })[0];

const run = (state: ViewState, ...events: ReadonlyArray<PickerEvent>) => {
  const commands: Array<Command | null> = [];
  let current = state;
  for (const event of events) {
    const [next, command] = update(current, event);
    current = next;
    commands.push(command);
  }
  return { state: current, commands };
};

const strings = pickerStrings({ _tag: "None" });

describe("ProfilePickerState", () => {
  it("focuses the last-used row, and opens unlocked rows straight away", () => {
    const state = loaded();
    assert.strictEqual(state.screen._tag, "List");
    assert.strictEqual(state.focusedId, "pwork000001");
    const { state: next, commands } = run(state, { _tag: "RowClicked", id: id("ppers000001") });
    assert.deepStrictEqual<unknown>(commands, [{ op: "open", id: "ppers000001", password: null }]);
    assert.isTrue(next.busy);
  });

  it("goes list, unlock, wrong password, retry, and clears the password field", () => {
    const { state, commands } = run(
      loaded(),
      { _tag: "RowClicked", id: id("pwork000001") },
      { _tag: "SubmitUnlock", id: id("pwork000001"), password: "" },
      { _tag: "SubmitUnlock", id: id("pwork000001"), password: "nope" },
      { _tag: "Failed", reason: "WrongPassword", message: "Wrong password." },
    );
    assert.deepStrictEqual<unknown>(commands, [
      null,
      null,
      { op: "open", id: "pwork000001", password: "nope" },
      null,
    ]);
    assert.strictEqual(state.unlockingId, "pwork000001");
    assert.deepStrictEqual(state.error, { field: "password", message: "Wrong password." });
    assert.strictEqual(state.fields.password, "");
    assert.isFalse(state.busy);

    const retry = run(state, { _tag: "SubmitUnlock", id: id("pwork000001"), password: "right" });
    assert.deepStrictEqual<unknown>(retry.commands, [
      { op: "open", id: "pwork000001", password: "right" },
    ]);
    assert.isNull(retry.state.error);
  });

  it("opens in unlock mode with that row focused and its password field open", () => {
    const state = loaded({ unlockProfileId: id("pwork000001") });
    assert.strictEqual(state.focusedId, "pwork000001");
    assert.strictEqual(state.unlockingId, "pwork000001");
  });

  it("shows the not-found banner above the list", () => {
    const state = loaded({ notice: { _tag: "ProfileNotFound", requestedId: "pgone000001" } });
    assert.strictEqual(state.screen._tag, "List");
    assert.isTrue(state.notFoundBanner);
  });

  it("validates the add form before it sends anything", () => {
    const cases = [
      [{ name: "  " }, "name", strings.nameRequired],
      [{ name: "x".repeat(41) }, "name", strings.nameTooLong],
      [
        { name: "Studio", password: "abc", confirmPassword: "abc" },
        "password",
        strings.passwordTooShort,
      ],
      [
        { name: "Studio", password: "abcd", confirmPassword: "abce" },
        "confirmPassword",
        strings.passwordMismatch,
      ],
    ] as const;
    for (const [fields, field, message] of cases) {
      const { state, commands } = run(loaded(), { _tag: "StartAdd" }, { _tag: "Submit", fields });
      assert.deepStrictEqual<unknown>(commands, [null, null]);
      assert.deepStrictEqual(state.error, { field, message });
      assert.deepStrictEqual(state.fields, fields);
    }
    const { commands } = run(
      loaded(),
      { _tag: "StartAdd" },
      { _tag: "Submit", fields: { name: " Studio ", password: "", confirmPassword: "" } },
    );
    assert.deepStrictEqual<unknown>(commands, [
      null,
      { op: "create", name: "Studio", password: null },
    ]);
  });

  it("returns to the list with the new row focused after a create", () => {
    const created = profile({ id: id("pnew0000001"), name: "Studio" });
    const { state, commands } = run(
      loaded(),
      { _tag: "StartAdd" },
      { _tag: "Submit", fields: { name: "Studio", password: "abcd", confirmPassword: "abcd" } },
      { _tag: "Succeeded", focusId: created.id },
      { _tag: "Refreshed", profiles: [...profiles, created], focusId: created.id },
    );
    assert.deepStrictEqual<unknown>(commands.slice(1, 3), [
      { op: "create", name: "Studio", password: "abcd" },
      { op: "refresh", focusId: "pnew0000001" },
    ]);
    assert.strictEqual(state.screen._tag, "List");
    assert.strictEqual(state.focusedId, "pnew0000001");
    assert.isFalse(state.busy);
  });

  it("asks a locked profile's password for rename, password changes and the Trash", () => {
    const locked = id("pwork000001");
    const rename = run(
      loaded(),
      { _tag: "StartRename", id: locked },
      { _tag: "Submit", fields: { name: "Office" } },
      { _tag: "Submit", fields: { name: "Office", password: "pw12" } },
    );
    assert.deepStrictEqual<unknown>(rename.commands, [
      null,
      null,
      { op: "rename", id: locked, name: "Office", password: "pw12" },
    ]);

    const remove = run(
      loaded(),
      { _tag: "StartRemovePassword", id: locked },
      { _tag: "Submit", fields: { currentPassword: "pw12" } },
      { _tag: "Failed", reason: "WrongPassword", message: "Wrong password." },
    );
    assert.deepStrictEqual<unknown>(remove.commands[1], {
      op: "setPassword",
      id: locked,
      currentPassword: "pw12",
      newPassword: null,
    });
    assert.deepStrictEqual(remove.state.error, {
      field: "currentPassword",
      message: "Wrong password.",
    });
    assert.strictEqual(remove.state.fields.currentPassword, "");

    const trash = run(
      loaded(),
      { _tag: "StartMoveToTrash", id: locked },
      { _tag: "Submit", fields: { password: "pw12" } },
    );
    assert.deepStrictEqual<unknown>(trash.commands, [
      null,
      { op: "moveToTrash", id: locked, password: "pw12" },
    ]);
  });

  it("never offers the Trash or Remove password where they do not apply", () => {
    const { state, commands } = run(
      loaded(),
      { _tag: "StartMoveToTrash", id: id("default") },
      { _tag: "StartRemovePassword", id: id("ppers000001") },
    );
    assert.deepStrictEqual<unknown>(commands, [null, null]);
    assert.strictEqual(state.screen._tag, "List");
    const unlocked = run(loaded(), { _tag: "StartMoveToTrash", id: id("ppers000001") });
    assert.deepStrictEqual<unknown>(unlocked.commands, [
      { op: "moveToTrash", id: "ppers000001", password: null },
    ]);
    assert.isFalse(run(unlocked.state, { _tag: "TrashCancelled" }).state.busy);
  });

  it("allows only Show file and Quit when the profiles file is unreadable", () => {
    const state = loaded({
      notice: { _tag: "RegistryUnreadable", registryPath: "/Users/u/.t3-profiles/profiles.json" },
      profiles: [],
    });
    assert.strictEqual(state.screen._tag, "Blocked");
    assert.include(state.strings?.registryUnreadable, "/Users/u/.t3-profiles/profiles.json");
    const { commands } = run(
      state,
      { _tag: "RowClicked", id: id("default") },
      { _tag: "StartAdd" },
      { _tag: "SubmitUnlock", id: id("default"), password: "pw12" },
      { _tag: "RevealRegistry" },
      { _tag: "Quit" },
    );
    assert.deepStrictEqual<unknown>(commands, [
      null,
      null,
      null,
      { op: "revealRegistry" },
      { op: "quit" },
    ]);
  });

  it("ignores clicks while a request is running", () => {
    const busy = run(loaded(), { _tag: "RowClicked", id: id("ppers000001") }).state;
    assert.deepStrictEqual(
      run(busy, { _tag: "RowClicked", id: id("default") }, { _tag: "StartAdd" })
        .commands as unknown,
      [null, null],
    );
  });
});
