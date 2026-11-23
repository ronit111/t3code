import { ipcRenderer } from "electron";

import { PROFILE_PICKER_CHANNELS } from "./ipc/channels.ts";
import type { ProfileErrorReason, ProfileSummary } from "./profiles/ProfileContract.ts";
import type { PickerState } from "./profiles/picker/ProfilePickerProtocol.ts";
import {
  type Command,
  type FieldName,
  type Fields,
  type PickerEvent,
  type ViewState,
  initialViewState,
  update,
} from "./profiles/picker/ProfilePickerState.ts";
import type { PickerStrings } from "./profiles/picker/ProfilePickerStrings.ts";

// Sandboxed and self-contained: import only types, electron and effect-free modules here.
type Result<A> =
  | { readonly ok: true; readonly value: A }
  | {
      readonly ok: false;
      readonly error: { readonly reason: ProfileErrorReason; readonly message: string };
    };

let state: ViewState = initialViewState;

const invoke = <A>(channel: string, payload?: unknown): Promise<Result<A>> =>
  ipcRenderer.invoke(channel, payload) as Promise<Result<A>>;

const dispatch = (event: PickerEvent) => {
  const [next, command] = update(state, event);
  state = next;
  render();
  if (command !== null) void run(command);
};

const settle = <A>(result: Result<A>, onOk: (value: A) => void) => {
  if (result.ok) onOk(result.value);
  else dispatch({ _tag: "Failed", reason: result.error.reason, message: result.error.message });
};

async function run(command: Command): Promise<void> {
  try {
    switch (command.op) {
      case "open":
        // On success the process relaunches into the profile; the view stays busy until then.
        settle(
          await invoke<void>(PROFILE_PICKER_CHANNELS.open, {
            id: command.id,
            password: command.password,
          }),
          () => {},
        );
        return;
      case "create":
        settle(
          await invoke<ProfileSummary>(PROFILE_PICKER_CHANNELS.create, {
            name: command.name,
            password: command.password,
          }),
          (profile) => dispatch({ _tag: "Succeeded", focusId: profile.id }),
        );
        return;
      case "rename":
        settle(
          await invoke<ProfileSummary>(PROFILE_PICKER_CHANNELS.rename, {
            id: command.id,
            name: command.name,
            password: command.password,
          }),
          (profile) => dispatch({ _tag: "Succeeded", focusId: profile.id }),
        );
        return;
      case "setPassword":
        settle(
          await invoke<ProfileSummary>(PROFILE_PICKER_CHANNELS.setPassword, {
            id: command.id,
            currentPassword: command.currentPassword,
            newPassword: command.newPassword,
          }),
          (profile) => dispatch({ _tag: "Succeeded", focusId: profile.id }),
        );
        return;
      case "moveToTrash":
        settle(
          await invoke<{ readonly moved: boolean }>(PROFILE_PICKER_CHANNELS.moveToTrash, {
            id: command.id,
            password: command.password,
          }),
          ({ moved }) =>
            dispatch(moved ? { _tag: "Succeeded", focusId: null } : { _tag: "TrashCancelled" }),
        );
        return;
      case "refresh":
        settle(await invoke<PickerState>(PROFILE_PICKER_CHANNELS.getState), (picker) =>
          dispatch({ _tag: "Refreshed", profiles: picker.profiles, focusId: command.focusId }),
        );
        return;
      case "revealRegistry":
        await invoke<void>(PROFILE_PICKER_CHANNELS.revealRegistry);
        return;
      case "quit":
        await invoke<void>(PROFILE_PICKER_CHANNELS.quit);
        return;
    }
  } catch {
    dispatch({
      _tag: "Failed",
      reason: "Io",
      message: state.strings?.unexpectedError ?? "",
    });
  }
}

type Child = Node | string | null | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | boolean>> = {},
  children: ReadonlyArray<Child> = [],
  on: Partial<Record<string, (event: Event) => void>> = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value === undefined) continue;
    element.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children) {
    if (child === null || child === false) continue;
    element.append(child);
  }
  for (const [type, listener] of Object.entries(on)) {
    if (listener) element.addEventListener(type, listener);
  }
  return element;
}

// Lucide paths (lock, ellipsis, plus), drawn here because the page loads no assets.
const ICONS = {
  lock: [
    ["rect", { width: "18", height: "11", x: "3", y: "11", rx: "2" }],
    ["path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }],
  ],
  more: [
    ["circle", { cx: "12", cy: "12", r: "1" }],
    ["circle", { cx: "19", cy: "12", r: "1" }],
    ["circle", { cx: "5", cy: "12", r: "1" }],
  ],
  plus: [["path", { d: "M5 12h14M12 5v14" }]],
} satisfies Record<string, ReadonlyArray<readonly [string, Record<string, string>]>>;

const icon = (name: keyof typeof ICONS) => {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attributes] of ICONS[name]) {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
};

const readFields = (form: HTMLFormElement): Fields => {
  const fields: Partial<Record<FieldName, string>> = {};
  for (const input of Array.from(form.querySelectorAll("input"))) {
    fields[input.name as FieldName] = input.value;
  }
  return fields;
};

const fieldError = (field: FieldName) =>
  state.error?.field === field ? h("span", { class: "error" }, [state.error.message]) : null;

const input = (field: FieldName, label: string, type: "text" | "password", autofocus = false) =>
  h("label", {}, [
    label,
    h("input", {
      name: field,
      type,
      value: state.fields[field] ?? "",
      autocomplete: "off",
      spellcheck: "false",
      "aria-invalid": state.error?.field === field ? "true" : false,
      "data-autofocus": autofocus || state.error?.field === field,
      disabled: state.busy,
    }),
    fieldError(field),
  ]);

const profileName = (strings: PickerStrings, profile: ProfileSummary) =>
  profile.name ?? strings.defaultName;

function renderRow(strings: PickerStrings, profile: ProfileSummary): HTMLElement {
  const unlocking = state.unlockingId === profile.id;
  const menuOpen = state.menuId === profile.id;
  const menu = menuOpen
    ? h("div", { class: "menu", role: "menu" }, [
        h("button", { role: "menuitem", type: "button" }, [strings.rename], {
          click: () => dispatch({ _tag: "StartRename", id: profile.id }),
        }),
        h(
          "button",
          { role: "menuitem", type: "button" },
          [profile.locked ? strings.changePassword : strings.setPassword],
          { click: () => dispatch({ _tag: "StartSetPassword", id: profile.id }) },
        ),
        profile.locked &&
          h("button", { role: "menuitem", type: "button" }, [strings.removePassword], {
            click: () => dispatch({ _tag: "StartRemovePassword", id: profile.id }),
          }),
        !profile.isDefault &&
          h(
            "button",
            { role: "menuitem", type: "button", class: "danger" },
            [strings.moveToTrash],
            {
              click: () => dispatch({ _tag: "StartMoveToTrash", id: profile.id }),
            },
          ),
      ])
    : null;
  const unlockForm = unlocking
    ? h(
        "form",
        { class: "unlock" },
        [
          h("div", { class: "inline" }, [
            h("input", {
              name: "password",
              type: "password",
              value: state.fields.password ?? "",
              "aria-label": strings.passwordLabel,
              placeholder: strings.passwordLabel,
              "aria-invalid": state.error?.field === "password" ? "true" : false,
              "data-autofocus": true,
              disabled: state.busy,
            }),
            h("button", { type: "submit", class: "primary", disabled: state.busy }, [strings.open]),
          ]),
          fieldError("password"),
          state.error !== null && state.error.field === null
            ? h("span", { class: "error" }, [state.error.message])
            : null,
        ],
        {
          submit: (event) => {
            event.preventDefault();
            const password = readFields(event.currentTarget as HTMLFormElement).password ?? "";
            dispatch({ _tag: "SubmitUnlock", id: profile.id, password });
          },
        },
      )
    : null;
  return h("div", { class: "row" }, [
    h("div", { class: "row-main" }, [
      h(
        "button",
        {
          type: "button",
          class: "row-open",
          "data-autofocus": state.focusedId === profile.id && !unlocking,
          disabled: state.busy,
        },
        [
          h("span", { class: "avatar", "aria-hidden": "true" }, [
            Array.from(profileName(strings, profile))[0]?.toLocaleUpperCase() ?? "",
          ]),
          h("span", { class: "row-name" }, [profileName(strings, profile)]),
          profile.locked ? icon("lock") : null,
          profile.lastUsed ? h("span", { class: "badge" }, [strings.lastUsed]) : null,
        ],
        { click: () => dispatch({ _tag: "RowClicked", id: profile.id }) },
      ),
      h(
        "button",
        {
          type: "button",
          class: "icon",
          "aria-label": strings.more,
          "aria-haspopup": "menu",
          "aria-expanded": menuOpen ? "true" : "false",
          disabled: state.busy,
        },
        [icon("more")],
        { click: () => dispatch({ _tag: "ToggleMenu", id: profile.id }) },
      ),
    ]),
    menu,
    unlockForm,
  ]);
}

function renderList(strings: PickerStrings): ReadonlyArray<Child> {
  const listError =
    state.unlockingId === null && state.error !== null
      ? h("p", { class: "error" }, [state.error.message])
      : null;
  return [
    h("h1", {}, [strings.heading]),
    state.notFoundBanner ? h("p", { class: "banner", role: "status" }, [strings.notFound]) : null,
    h(
      "div",
      { class: "list" },
      state.profiles.map((profile) => renderRow(strings, profile)),
    ),
    listError,
    h("div", { class: "actions" }, [
      h("button", { type: "button", disabled: state.busy }, [icon("plus"), strings.addProfile], {
        click: () => dispatch({ _tag: "StartAdd" }),
      }),
    ]),
  ];
}

function renderForm(
  strings: PickerStrings,
  title: string,
  submitLabel: string,
  fields: ReadonlyArray<Child>,
): ReadonlyArray<Child> {
  return [
    h(
      "form",
      {},
      [
        h("h1", {}, [title]),
        ...fields,
        state.error !== null && state.error.field === null
          ? h("p", { class: "error" }, [state.error.message])
          : null,
        h("div", { class: "actions" }, [
          h("button", { type: "button", disabled: state.busy }, [strings.cancel], {
            click: () => dispatch({ _tag: "Cancel" }),
          }),
          h("button", { type: "submit", class: "primary", disabled: state.busy }, [submitLabel]),
        ]),
      ],
      {
        submit: (event) => {
          event.preventDefault();
          dispatch({ _tag: "Submit", fields: readFields(event.currentTarget as HTMLFormElement) });
        },
      },
    ),
  ];
}

function renderScreen(strings: PickerStrings): ReadonlyArray<Child> {
  const screen = state.screen;
  const locked = (id: string) => state.profiles.some((p) => p.id === id && p.locked);
  switch (screen._tag) {
    case "Loading":
      return [];
    case "Blocked":
      return [
        h("p", { role: "alert", class: "banner alert" }, [strings.registryUnreadable]),
        h("div", { class: "actions" }, [
          h("button", { type: "button" }, [strings.showFile], {
            click: () => dispatch({ _tag: "RevealRegistry" }),
          }),
          h(
            "button",
            { type: "button", class: "primary", "data-autofocus": true },
            [strings.quit],
            {
              click: () => dispatch({ _tag: "Quit" }),
            },
          ),
        ]),
      ];
    case "List":
      return renderList(strings);
    case "Add":
      return renderForm(strings, strings.addTitle, strings.add, [
        input("name", strings.nameLabel, "text", true),
        input("password", strings.passwordOptionalLabel, "password"),
        input("confirmPassword", strings.confirmPasswordLabel, "password"),
        h("p", { class: "muted" }, [strings.lockHint]),
      ]);
    case "Rename":
      return renderForm(strings, strings.renameTitle, strings.save, [
        input("name", strings.nameLabel, "text", true),
        locked(screen.id) && input("password", strings.passwordLabel, "password"),
      ]);
    case "SetPassword":
      return renderForm(
        strings,
        locked(screen.id) ? strings.changePasswordTitle : strings.setPasswordTitle,
        strings.save,
        [
          locked(screen.id) &&
            input("currentPassword", strings.currentPasswordLabel, "password", true),
          input("newPassword", strings.newPasswordLabel, "password", !locked(screen.id)),
          input("confirmPassword", strings.confirmPasswordLabel, "password"),
          h("p", { class: "muted" }, [strings.lockHint]),
        ],
      );
    case "RemovePassword":
      return renderForm(strings, strings.removePasswordTitle, strings.remove, [
        input("currentPassword", strings.currentPasswordLabel, "password", true),
      ]);
    case "MoveToTrash":
      return renderForm(strings, strings.moveToTrashTitle, strings.continue, [
        h("p", {}, [strings.moveToTrashHint]),
        input("password", strings.passwordLabel, "password", true),
      ]);
  }
}

function render(): void {
  const root = document.getElementById("root");
  const strings = state.strings;
  if (root === null || strings === null) return;
  document.title = strings.windowTitle;
  root.replaceChildren(
    ...renderScreen(strings).filter((child) => child !== null && child !== false),
  );
  const target =
    root.querySelector<HTMLElement>('[aria-invalid="true"]') ??
    root.querySelector<HTMLElement>('[role="menuitem"]') ??
    root.querySelector<HTMLElement>("[data-autofocus]");
  target?.focus();
  // The menu opens upward when it would run past the window and there is room above.
  const menu = root.querySelector<HTMLElement>(".menu");
  if (menu !== null) {
    const { top, bottom, height } = menu.getBoundingClientRect();
    if (bottom > window.innerHeight - 8 && top - height - 52 > 40) menu.classList.add("up");
  }
}

window.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.menuId !== null) dispatch({ _tag: "ToggleMenu", id: state.menuId });
    else if (state.screen._tag !== "List" && state.screen._tag !== "Blocked") {
      dispatch({ _tag: "Cancel" });
    }
  });
  void invoke<PickerState>(PROFILE_PICKER_CHANNELS.getState).then(
    (result) => {
      if (result.ok) dispatch({ _tag: "Loaded", state: result.value });
      else document.getElementById("root")?.replaceChildren(result.error.message);
    },
    () => {},
  );
});
