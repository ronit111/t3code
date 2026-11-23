import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ClaudeConnectorDefinition, ClaudeConnectorName } from "./claudeConnectors.ts";

const isName = Schema.is(ClaudeConnectorName);
const isDefinition = Schema.is(ClaudeConnectorDefinition);

describe("ClaudeConnectorName", () => {
  it.each([
    ["linear", true],
    ["my-server_2.prod", true],
    ["9lives", true],
    ["has space", false],
    [".hidden", false],
    ["-flag", false],
    ["a".repeat(64), true],
    ["a".repeat(65), false],
  ])("%s → %s", (name, valid) => {
    expect(isName(name)).toBe(valid);
  });
});

describe("ClaudeConnectorDefinition", () => {
  it("accepts http(s) URLs only", () => {
    const web = (url: string) => ({ transport: "http", url, headers: [] });
    expect(isDefinition(web("https://mcp.example.com/mcp"))).toBe(true);
    expect(isDefinition(web("http://localhost:3000/mcp"))).toBe(true);
    expect(isDefinition(web("javascript:alert(1)"))).toBe(false);
    expect(isDefinition(web("ftp://example.com"))).toBe(false);
    expect(isDefinition({ transport: "sse", url: "https://example.com/sse", headers: [] })).toBe(
      true,
    );
  });

  it("validates header and environment key names", () => {
    const withHeader = (name: string) => ({
      transport: "http",
      url: "https://example.com",
      headers: [{ name, value: "v" }],
    });
    const withEnv = (name: string) => ({
      transport: "stdio",
      command: "npx",
      args: [],
      env: [{ name, value: "v" }],
    });
    expect(isDefinition(withHeader("Authorization"))).toBe(true);
    expect(isDefinition(withHeader("X-Api-Key"))).toBe(true);
    expect(isDefinition(withHeader("Bad Header"))).toBe(false);
    expect(isDefinition(withHeader("1st"))).toBe(false);
    expect(isDefinition(withEnv("API_KEY"))).toBe(true);
    expect(isDefinition(withEnv("API=KEY"))).toBe(false);
  });
});
