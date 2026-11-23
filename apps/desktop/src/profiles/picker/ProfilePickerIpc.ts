import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopIpc from "../../ipc/DesktopIpc.ts";
import { PROFILE_PICKER_CHANNELS } from "../../ipc/channels.ts";
import {
  type PickerLaunch,
  type ProfileError,
  ProfileService,
  ProfileSummary,
} from "../ProfileContract.ts";
import {
  CreatePayload,
  MoveToTrashResult,
  PickerResult,
  PickerState,
  ProfilePasswordPayload,
  RenamePayload,
  SetPasswordPayload,
} from "./ProfilePickerProtocol.ts";
import { moveToTrashDialog, pickerErrorMessage, pickerStrings } from "./ProfilePickerStrings.ts";

export interface PickerIpcDeps {
  readonly ipcMain: DesktopIpc.DesktopIpcMain;
  readonly window: {
    readonly webContents: { readonly id: number; readonly mainFrame: unknown };
  };
  readonly launch: PickerLaunch;
  /** Native confirmation; true when the user chose the confirm button. */
  readonly confirm: (dialog: ReturnType<typeof moveToTrashDialog>) => Effect.Effect<boolean>;
  readonly showItemInFolder: (path: string) => void;
  readonly quit: () => void;
}

const toResult = <A, R>(effect: Effect.Effect<A, ProfileError, R>) =>
  effect.pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catchTags({
      DesktopProfileError: (error) =>
        Effect.succeed({
          ok: false as const,
          error: { reason: error.reason, message: pickerErrorMessage(error.reason, error.detail) },
        }),
    }),
  );

/** Registers the picker window's handlers for the current scope. Payloads are never logged. */
export const registerPickerIpc = Effect.fn("DesktopProfiles.registerPickerIpc")(function* (
  deps: PickerIpcDeps,
) {
  const service = yield* ProfileService;
  const { launch } = deps;
  const ipc = DesktopIpc.make(deps.ipcMain, (event) =>
    Effect.succeed(
      event.sender.id === deps.window.webContents.id &&
        event.senderFrame === deps.window.webContents.mainFrame,
    ),
  );
  const strings = pickerStrings(launch.notice);

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PROFILE_PICKER_CHANNELS.getState,
      payload: Schema.Void,
      result: PickerResult(PickerState),
      handler: () =>
        toResult(
          (launch.notice._tag === "RegistryUnreadable" ? Effect.succeed([]) : service.list).pipe(
            Effect.map((profiles) => ({
              strings,
              profiles,
              unlockProfileId: launch.unlockProfileId,
              notice: launch.notice,
            })),
          ),
        ),
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PROFILE_PICKER_CHANNELS.create,
      payload: CreatePayload,
      result: PickerResult(ProfileSummary),
      handler: (input) => toResult(service.create(input)),
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PROFILE_PICKER_CHANNELS.rename,
      payload: RenamePayload,
      result: PickerResult(ProfileSummary),
      handler: (input) => toResult(service.rename(input)),
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PROFILE_PICKER_CHANNELS.setPassword,
      payload: SetPasswordPayload,
      result: PickerResult(ProfileSummary),
      handler: (input) => toResult(service.setPassword(input)),
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PROFILE_PICKER_CHANNELS.moveToTrash,
      payload: ProfilePasswordPayload,
      result: PickerResult(MoveToTrashResult),
      handler: (input) =>
        toResult(
          Effect.gen(function* () {
            const profile = (yield* service.list).find((entry) => entry.id === input.id);
            const confirmed = yield* deps.confirm(
              moveToTrashDialog(profile?.name ?? strings.defaultName, launch.profilesRoot),
            );
            if (!confirmed) return { moved: false };
            yield* service.moveToTrash(input);
            return { moved: true };
          }),
        ),
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PROFILE_PICKER_CHANNELS.open,
      payload: ProfilePasswordPayload,
      result: PickerResult(Schema.Void),
      handler: (input) => toResult(service.open(input)),
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PROFILE_PICKER_CHANNELS.revealRegistry,
      payload: Schema.Void,
      result: PickerResult(Schema.Void),
      handler: () =>
        toResult(
          Effect.sync(() => {
            if (launch.notice._tag === "RegistryUnreadable") {
              deps.showItemInFolder(launch.notice.registryPath);
            }
          }),
        ),
    }),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: PROFILE_PICKER_CHANNELS.quit,
      payload: Schema.Void,
      result: PickerResult(Schema.Void),
      handler: () => toResult(Effect.sync(deps.quit)),
    }),
  );
});
