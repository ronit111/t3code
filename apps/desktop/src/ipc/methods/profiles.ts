import { DesktopActiveProfileSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { DesktopProfileSwitch } from "../../profiles/ProfileContract.ts";
import * as IpcChannels from "../channels.ts";
import { makeIpcMethod, makeSyncIpcMethod } from "../DesktopIpc.ts";

/** The preload asks once, synchronously, before it decides whether to expose `profiles`. */
export const getProfilesEnabled = makeSyncIpcMethod({
  channel: IpcChannels.PROFILES_ENABLED_CHANNEL,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.profiles.getEnabled")(function* () {
    return (yield* DesktopProfileSwitch).active.profilesRoot !== null;
  }),
});

export const getActiveProfile = makeIpcMethod({
  channel: IpcChannels.PROFILES_GET_ACTIVE_CHANNEL,
  payload: Schema.Void,
  result: DesktopActiveProfileSchema,
  handler: Effect.fn("desktop.ipc.profiles.getActive")(function* () {
    const { active } = yield* DesktopProfileSwitch;
    return { id: active.id, name: active.name, isDefault: active.isDefault };
  }),
});

export const switchProfile = makeIpcMethod({
  channel: IpcChannels.PROFILES_SWITCH_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.profiles.switch")(function* () {
    return yield* (yield* DesktopProfileSwitch).switchToPicker;
  }),
});
