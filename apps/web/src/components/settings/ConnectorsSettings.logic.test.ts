import { describe, expect, it } from "vite-plus/test";

import {
  buildConnectorDefinition,
  parseArgumentLines,
  parseKeyValueLines,
  type ConnectorDraft,
} from "./ConnectorsSettings.logic";

const draft = (overrides: Partial<ConnectorDraft>): ConnectorDraft => ({
  name: "server",
  kind: "http",
  url: "https://mcp.example.com/mcp",
  headers: "",
  command: "",
  args: "",
  env: "",
  ...overrides,
});

describe("parseKeyValueLines", () => {
  it("reads headers and environment lines, skipping blank ones and keeping separators in values", () => {
    expect(
      parseKeyValueLines("Authorization: Bearer a:b\n\n  X-Team:  core  \r\n", "headers"),
    ).toEqual({
      ok: true,
      value: [
        { name: "Authorization", value: "Bearer a:b" },
        { name: "X-Team", value: "core" },
      ],
    });
    expect(parseKeyValueLines("API_KEY=abc=def\nEMPTY=", "env")).toEqual({
      ok: true,
      value: [
        { name: "API_KEY", value: "abc=def" },
        { name: "EMPTY", value: "" },
      ],
    });
  });

  it.each([
    ["Authorization Bearer", "headers", { _tag: "MalformedLine", field: "headers", line: 1 }],
    ["=value", "env", { _tag: "MalformedLine", field: "env", line: 1 }],
    ["OK=1\nBAD KEY=2", "env", { _tag: "InvalidKey", field: "env", line: 2 }],
    ["A=1\nA=2", "env", { _tag: "DuplicateKey", field: "env", key: "A" }],
    [
      "Authorization: a\nauthorization: b",
      "headers",
      { _tag: "DuplicateKey", field: "headers", key: "authorization" },
    ],
  ] as const)("rejects %j", (text, field, error) => {
    expect(parseKeyValueLines(text, field)).toEqual({ ok: false, error });
  });

  it("treats environment names as case-sensitive", () => {
    expect(parseKeyValueLines("path=a\nPATH=b", "env").ok).toBe(true);
  });
});

describe("parseArgumentLines", () => {
  it("keeps one argument per non-blank line, spaces inside included", () => {
    expect(parseArgumentLines("-y\n\n@scope/server\n--root /my files\n")).toEqual([
      "-y",
      "@scope/server",
      "--root /my files",
    ]);
  });
});

describe("buildConnectorDefinition", () => {
  it("builds a web connector", () => {
    expect(
      buildConnectorDefinition(draft({ kind: "sse", headers: "Authorization: Bearer t" })),
    ).toEqual({
      ok: true,
      value: {
        name: "server",
        definition: {
          transport: "sse",
          url: "https://mcp.example.com/mcp",
          headers: [{ name: "Authorization", value: "Bearer t" }],
        },
      },
    });
  });

  it("builds a command connector", () => {
    expect(
      buildConnectorDefinition(
        draft({ kind: "stdio", command: " npx ", args: "-y\nserver", env: "API_KEY=k" }),
      ),
    ).toEqual({
      ok: true,
      value: {
        name: "server",
        definition: {
          transport: "stdio",
          command: "npx",
          args: ["-y", "server"],
          env: [{ name: "API_KEY", value: "k" }],
        },
      },
    });
  });

  it.each([
    [{ name: "has space" }, "InvalidName"],
    [{ name: ".hidden" }, "InvalidName"],
    [{ url: "ftp://example.com" }, "InvalidUrl"],
    [{ url: "" }, "InvalidUrl"],
    [{ kind: "stdio", command: "  " }, "InvalidCommand"],
    [{ headers: "no separator" }, "MalformedLine"],
  ] as const)("rejects %j with %s", (overrides, tag) => {
    const result = buildConnectorDefinition(draft(overrides));
    expect(result.ok ? null : result.error._tag).toBe(tag);
  });
});
