import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Ref from "effect/Ref";
import * as References from "effect/References";

import type * as DesktopIpc from "../../ipc/DesktopIpc.ts";
import {
  type PickerLaunch,
  ProfileError,
  type ProfileErrorReason,
  ProfileErrorReason as ProfileErrorReasonSchema,
  type ProfileId,
  ProfileService,
} from "../ProfileContract.ts";
import { registerPickerIpc } from "./ProfilePickerIpc.ts";
import { makeProfileServiceTestDouble } from "./ProfileServiceTestDouble.ts";

const SECRET = "hunter2-secret";
const mainFrame = { frame: "main" };
const trusted = { sender: { id: 7 }, senderFrame: mainFrame };

const launch: PickerLaunch = {
  _tag: "Picker",
  profilesRoot: "/Users/u/.t3-profiles",
  userDataPath: "/Users/u/Library/Application Support/t3code-v2-picker",
  appDataDirectory: "/Users/u/Library/Application Support",
  defaultHome: "/Users/u/.t3",
  isDevelopment: false,
  unlockProfileId: null,
  notice: { _tag: "None" },
};

const profiles = [
  { id: "default" as ProfileId, name: null, isDefault: true, locked: false, lastUsed: false },
  {
    id: "pwork000001" as ProfileId,
    name: "Work",
    isDefault: false,
    locked: true,
    lastUsed: true,
    password: SECRET,
  },
];

const setup = (options: { readonly confirm?: boolean; readonly launch?: PickerLaunch } = {}) =>
  Effect.gen(function* () {
    const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
    const double = yield* makeProfileServiceTestDouble({ profiles });
    const confirms = yield* Ref.make(0);
    const revealed: Array<string> = [];
    const logs: Array<string> = [];
    const logger = Logger.make(({ message, fiber }) => {
      logs.push(JSON.stringify([message, fiber.getRef(References.CurrentLogAnnotations)]));
    });
    yield* registerPickerIpc({
      ipcMain: {
        handle: (channel, listener) => {
          handlers.set(channel, listener);
        },
        removeHandler: (channel) => {
          handlers.delete(channel);
        },
        on: () => {},
        removeAllListeners: () => {},
      },
      window: { webContents: { id: 7, mainFrame } },
      launch: options.launch ?? launch,
      confirm: () => Ref.update(confirms, (n) => n + 1).pipe(Effect.as(options.confirm ?? true)),
      showItemInFolder: (path) => revealed.push(path),
      quit: () => {},
    }).pipe(
      Effect.provide(
        Layer.mergeAll(double.layer, Logger.layer([logger], { mergeWithExisting: false })),
      ),
      Effect.provideService(References.MinimumLogLevel, "All"),
    );
    const invoke = (channel: string, payload?: unknown, event: unknown = trusted) =>
      Effect.promise(() =>
        Promise.resolve(
          handlers.get(channel)!(event as DesktopIpc.DesktopIpcInvokeEvent, payload),
        ).then(
          (value) => ({ rejected: false as const, value }),
          (error: unknown) => ({ rejected: true as const, error }),
        ),
      );
    return { double, confirms, revealed, logs, invoke };
  });

const reasons: ReadonlyArray<ProfileErrorReason> = ProfileErrorReasonSchema.literals;

describe("ProfilePickerIpc", () => {
  it.effect("rejects other webContents and subframes before calling the service", () =>
    Effect.gen(function* () {
      const { double, invoke } = yield* setup();
      for (const event of [
        { sender: { id: 8 }, senderFrame: mainFrame },
        { sender: { id: 7 }, senderFrame: { frame: "sub" } },
      ]) {
        const result = yield* invoke(
          "profile-picker:open",
          { id: "default", password: null },
          event,
        );
        assert.isTrue(result.rejected);
      }
      assert.deepStrictEqual(yield* Ref.get(double.calls), []);
    }).pipe(Effect.scoped),
  );

  it.effect("rejects a bad payload as a decode error without calling the service", () =>
    Effect.gen(function* () {
      const { double, invoke } = yield* setup();
      for (const payload of [undefined, { id: "../etc", password: null }, { id: "default" }]) {
        const result = yield* invoke("profile-picker:open", payload);
        assert.isTrue(result.rejected);
      }
      assert.deepStrictEqual(yield* Ref.get(double.calls), []);
    }).pipe(Effect.scoped),
  );

  it.effect("returns every ProfileError reason as data", () =>
    Effect.gen(function* () {
      for (const reason of reasons) {
        const handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
        yield* registerPickerIpc({
          ipcMain: {
            handle: (channel, listener) => {
              handlers.set(channel, listener);
            },
            removeHandler: () => {},
            on: () => {},
            removeAllListeners: () => {},
          },
          window: { webContents: { id: 7, mainFrame } },
          launch,
          confirm: () => Effect.succeed(true),
          showItemInFolder: () => {},
          quit: () => {},
        }).pipe(
          Effect.provide(
            Layer.mock(ProfileService, {
              create: () => Effect.fail(new ProfileError({ reason, detail: "detail" })),
            }),
          ),
        );
        const result = yield* Effect.promise(() =>
          Promise.resolve(
            handlers.get("profile-picker:create")!(trusted, { name: "Personal", password: null }),
          ),
        );
        assert.deepInclude(result, { ok: false });
        assert.strictEqual((result as { error: { reason: string } }).error.reason, reason);
      }
    }).pipe(Effect.scoped),
  );

  it.effect("opens through the service and records the id", () =>
    Effect.gen(function* () {
      const { double, invoke } = yield* setup();
      const wrong = yield* invoke("profile-picker:open", { id: "pwork000001", password: "nope" });
      assert.deepInclude(wrong, { rejected: false });
      assert.deepNestedInclude(wrong, { "value.error.reason": "WrongPassword" });
      const right = yield* invoke("profile-picker:open", { id: "pwork000001", password: SECRET });
      assert.deepNestedInclude(right, { "value.ok": true });
      assert.deepStrictEqual<unknown>(yield* Ref.get(double.opened), ["pwork000001"]);
    }).pipe(Effect.scoped),
  );

  it.effect("moves nothing to the Trash when the user cancels the dialog", () =>
    Effect.gen(function* () {
      const { double, confirms, invoke } = yield* setup({ confirm: false });
      const result = yield* invoke("profile-picker:move-to-trash", {
        id: "pwork000001",
        password: SECRET,
      });
      assert.deepStrictEqual(result, {
        rejected: false,
        value: { ok: true, value: { moved: false } },
      });
      assert.strictEqual(yield* Ref.get(confirms), 1);
      const calls = yield* Ref.get(double.calls);
      assert.isFalse(calls.some((call) => call.op === "moveToTrash"));
    }).pipe(Effect.scoped),
  );

  it.effect("returns an empty list and reveals the file when the registry is unreadable", () =>
    Effect.gen(function* () {
      const registryPath = "/Users/u/.t3-profiles/profiles.json";
      const { double, revealed, invoke } = yield* setup({
        launch: { ...launch, notice: { _tag: "RegistryUnreadable", registryPath } },
      });
      const state = yield* invoke("profile-picker:get-state");
      assert.deepNestedInclude(state, { "value.ok": true });
      assert.deepNestedInclude(state, { "value.value.profiles": [] });
      yield* invoke("profile-picker:reveal-registry");
      assert.deepStrictEqual(revealed, [registryPath]);
      assert.deepStrictEqual(yield* Ref.get(double.calls), []);
    }).pipe(Effect.scoped),
  );

  it.effect("never writes a password to the logs", () =>
    Effect.gen(function* () {
      const { logs, invoke } = yield* setup();
      yield* invoke("profile-picker:open", { id: "pwork000001", password: SECRET });
      yield* invoke("profile-picker:create", { name: "Personal", password: SECRET });
      yield* invoke("profile-picker:set-password", {
        id: "pwork000001",
        currentPassword: SECRET,
        newPassword: `${SECRET}-new`,
      });
      yield* invoke("profile-picker:rename", { id: "pwork000001", name: 7, password: SECRET });
      assert.isFalse(logs.some((line) => line.includes(SECRET)));
    }).pipe(Effect.scoped),
  );
});
