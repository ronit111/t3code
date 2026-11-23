import {
  ClaudeConnectorDefinition,
  ClaudeConnectorName,
  type ClaudeConnectorsAddInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export type ConnectorKind = "http" | "sse" | "stdio";

export interface ConnectorDraft {
  readonly name: string;
  readonly kind: ConnectorKind;
  readonly url: string;
  /** One `Name: value` per line. */
  readonly headers: string;
  readonly command: string;
  /** One argument per line. */
  readonly args: string;
  /** One `NAME=value` per line. */
  readonly env: string;
}

export type ConnectorDraftField = "headers" | "env";

export type ConnectorDraftError =
  | { readonly _tag: "InvalidName" }
  | { readonly _tag: "InvalidUrl" }
  | { readonly _tag: "InvalidCommand" }
  | { readonly _tag: "MalformedLine"; readonly field: ConnectorDraftField; readonly line: number }
  | { readonly _tag: "InvalidKey"; readonly field: ConnectorDraftField; readonly line: number }
  | { readonly _tag: "DuplicateKey"; readonly field: ConnectorDraftField; readonly key: string }
  | { readonly _tag: "ValueTooLong"; readonly field: ConnectorDraftField; readonly line: number };

type Parsed<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: ConnectorDraftError };

type KeyValue = { readonly name: string; readonly value: string };

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,127}$/;
const MAX_VALUE_LENGTH = 8192;
const isName = Schema.is(ClaudeConnectorName);
const isDefinition = Schema.is(ClaudeConnectorDefinition);

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line.length > 0);

/** Splits each line at its first separator, so a value may itself hold one. */
export function parseKeyValueLines(
  text: string,
  field: ConnectorDraftField,
): Parsed<ReadonlyArray<KeyValue>> {
  const separator = field === "headers" ? ":" : "=";
  const seen = new Set<string>();
  const pairs: Array<KeyValue> = [];
  for (const { line, number } of lines(text)) {
    const at = line.indexOf(separator);
    if (at <= 0) return { ok: false, error: { _tag: "MalformedLine", field, line: number } };
    const name = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (!KEY_PATTERN.test(name)) {
      return { ok: false, error: { _tag: "InvalidKey", field, line: number } };
    }
    if (value.length > MAX_VALUE_LENGTH) {
      return { ok: false, error: { _tag: "ValueTooLong", field, line: number } };
    }
    // HTTP header names ignore case; environment names do not.
    const key = field === "headers" ? name.toLowerCase() : name;
    if (seen.has(key)) return { ok: false, error: { _tag: "DuplicateKey", field, key: name } };
    seen.add(key);
    pairs.push({ name, value });
  }
  return { ok: true, value: pairs };
}

export function parseArgumentLines(text: string): ReadonlyArray<string> {
  return lines(text).map(({ line }) => line);
}

export function buildConnectorDefinition(
  draft: ConnectorDraft,
): Parsed<Omit<ClaudeConnectorsAddInput, "instanceId">> {
  const name = draft.name.trim();
  if (!isName(name)) return { ok: false, error: { _tag: "InvalidName" } };
  if (draft.kind === "stdio") {
    const command = draft.command.trim();
    if (command.length === 0) return { ok: false, error: { _tag: "InvalidCommand" } };
    const env = parseKeyValueLines(draft.env, "env");
    if (!env.ok) return env;
    const definition = {
      transport: "stdio" as const,
      command,
      args: parseArgumentLines(draft.args),
      env: env.value,
    };
    if (!isDefinition(definition)) return { ok: false, error: { _tag: "InvalidCommand" } };
    return { ok: true, value: { name, definition } };
  }
  const headers = parseKeyValueLines(draft.headers, "headers");
  if (!headers.ok) return headers;
  const definition = { transport: draft.kind, url: draft.url.trim(), headers: headers.value };
  if (!isDefinition(definition)) return { ok: false, error: { _tag: "InvalidUrl" } };
  return { ok: true, value: { name, definition } };
}
