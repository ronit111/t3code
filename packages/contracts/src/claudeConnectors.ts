import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";
import { SignInUrl } from "./providerSetup.ts";

export const ClaudeConnectorName = TrimmedNonEmptyString.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/),
);
export type ClaudeConnectorName = typeof ClaudeConnectorName.Type;

const KeyValue = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/)),
  value: Schema.String.check(Schema.isMaxLength(8192)),
});

export const ClaudeConnectorDefinition = Schema.Union([
  Schema.Struct({
    transport: Schema.Literal("stdio"),
    command: TrimmedNonEmptyString.check(Schema.isMaxLength(4096)),
    args: Schema.Array(Schema.String.check(Schema.isMaxLength(4096))),
    env: Schema.Array(KeyValue),
  }),
  Schema.Struct({
    transport: Schema.Literals(["http", "sse"]),
    url: TrimmedNonEmptyString.check(Schema.isPattern(/^https?:\/\//)),
    headers: Schema.Array(KeyValue),
  }),
]);
export type ClaudeConnectorDefinition = typeof ClaudeConnectorDefinition.Type;

export const ClaudeConnectorSummary = Schema.Struct({
  name: Schema.String,
  transport: Schema.Literals(["stdio", "http", "sse", "ws", "unknown"]),
  /** URL, or command and args. Never env or header values. */
  target: Schema.String,
  /** Names only, so the page can say "uses API_KEY" without showing it. */
  secretNames: Schema.Array(Schema.String),
  canSignIn: Schema.Boolean,
});
export type ClaudeConnectorSummary = typeof ClaudeConnectorSummary.Type;

export const ClaudeConnectorsState = Schema.Struct({
  instanceId: ProviderInstanceId,
  configDir: Schema.String,
  servers: Schema.Array(ClaudeConnectorSummary),
  /** false when <configDir>/settings.json has disableClaudeAiConnectors: true. */
  accountConnectorsEnabled: Schema.Boolean,
});
export type ClaudeConnectorsState = typeof ClaudeConnectorsState.Type;

export class ClaudeConnectorsError extends Schema.TaggedError<ClaudeConnectorsError>()(
  "ClaudeConnectorsError",
  {
    reason: Schema.Literals([
      "InstanceNotFound",
      "NotClaudeInstance",
      "NameTaken",
      "NotFound",
      "CliMissing",
      "CliFailed",
      "ConfigUnreadable",
      "SignInExpired",
      "SignInFailed",
    ]),
    /** Safe to show; never CLI output, URLs, codes or tokens. */
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const ClaudeConnectorsListInput = Schema.Struct({ instanceId: ProviderInstanceId });
export type ClaudeConnectorsListInput = typeof ClaudeConnectorsListInput.Type;

export const ClaudeConnectorsAddInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  name: ClaudeConnectorName,
  definition: ClaudeConnectorDefinition,
});
export type ClaudeConnectorsAddInput = typeof ClaudeConnectorsAddInput.Type;

export const ClaudeConnectorsNamedInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  name: ClaudeConnectorName,
});
export type ClaudeConnectorsNamedInput = typeof ClaudeConnectorsNamedInput.Type;

export const ClaudeConnectorsSetAccountConnectorsInput = Schema.Struct({
  instanceId: ProviderInstanceId,
  enabled: Schema.Boolean,
});
export type ClaudeConnectorsSetAccountConnectorsInput =
  typeof ClaudeConnectorsSetAccountConnectorsInput.Type;

export const ClaudeConnectorsSignInStartResult = Schema.Struct({
  signInId: Schema.String,
  authorizationUrl: SignInUrl,
});
export type ClaudeConnectorsSignInStartResult = typeof ClaudeConnectorsSignInStartResult.Type;

export const ClaudeConnectorsSignInCompleteInput = Schema.Struct({
  signInId: Schema.String,
  /** The address the browser ended on after approving, usually a localhost page. */
  callbackUrl: TrimmedNonEmptyString.check(Schema.isMaxLength(16_384)),
});
export type ClaudeConnectorsSignInCompleteInput = typeof ClaudeConnectorsSignInCompleteInput.Type;

export const ClaudeConnectorsSignInCompleteResult = Schema.Struct({ signedInAt: IsoDateTime });
export type ClaudeConnectorsSignInCompleteResult = typeof ClaudeConnectorsSignInCompleteResult.Type;

export const ClaudeConnectorsSignInCancelInput = Schema.Struct({ signInId: Schema.String });
export type ClaudeConnectorsSignInCancelInput = typeof ClaudeConnectorsSignInCancelInput.Type;
