import * as Schema from "effect/Schema";

import { ProfileErrorReason, ProfileId, ProfileSummary } from "../ProfileContract.ts";

export const PickerResult = <A extends Schema.Top>(value: A) =>
  Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value }),
    Schema.Struct({
      ok: Schema.Literal(false),
      error: Schema.Struct({ reason: ProfileErrorReason, message: Schema.String }),
    }),
  ]);

export const PickerNoticeSchema = Schema.Union([
  Schema.TaggedStruct("None", {}),
  Schema.TaggedStruct("ProfileNotFound", { requestedId: Schema.String }),
  Schema.TaggedStruct("RegistryUnreadable", { registryPath: Schema.String }),
]);

export const PickerState = Schema.Struct({
  strings: Schema.Record(Schema.String, Schema.String),
  profiles: Schema.Array(ProfileSummary),
  unlockProfileId: Schema.NullOr(ProfileId),
  notice: PickerNoticeSchema,
});
export type PickerState = typeof PickerState.Type;

export const CreatePayload = Schema.Struct({
  name: Schema.String,
  password: Schema.NullOr(Schema.String),
});

export const RenamePayload = Schema.Struct({
  id: ProfileId,
  name: Schema.String,
  password: Schema.NullOr(Schema.String),
});

export const SetPasswordPayload = Schema.Struct({
  id: ProfileId,
  currentPassword: Schema.NullOr(Schema.String),
  newPassword: Schema.NullOr(Schema.String),
});

export const ProfilePasswordPayload = Schema.Struct({
  id: ProfileId,
  password: Schema.NullOr(Schema.String),
});

export const MoveToTrashResult = Schema.Struct({ moved: Schema.Boolean });
