import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  assertNoUpdateFeed,
  assertPickerBundled,
  backupRefName,
  parseLsRemoteTags,
  pickLatestStableTag,
  planSteps,
  readDotEnvValue,
  scrubBuildEnv,
  stripTagPrefix,
  type PlanInput,
} from "./fork-release.ts";

describe("pickLatestStableTag", () => {
  it("keeps only vX.Y.Z and sorts by semver, not text", () => {
    assert.equal(
      pickLatestStableTag([
        "v0.1.9",
        "v0.1.10",
        "v0.1.12-nightly.20261123.5124",
        "v0.2.0-preview.20261120.1",
        "v0.2.0-pr.41141",
        "v0.1.11",
        "v0.1.11.1",
        "0.3.0",
        "v1.0",
        "fork-base/profiles",
      ]),
      "v0.1.11",
    );
    assert.equal(pickLatestStableTag(["v2.0.0", "v10.0.0", "v9.99.99"]), "v10.0.0");
    assert.equal(pickLatestStableTag(["v1.0.0-nightly.1"]), undefined);
  });

  it("reads lightweight and annotated tags from ls-remote output", () => {
    const tags = parseLsRemoteTags(
      [
        `${"a".repeat(40)}\trefs/tags/v0.1.10`,
        `${"b".repeat(40)}\trefs/tags/v0.1.11`,
        `${"c".repeat(40)}\trefs/tags/v0.1.11^{}`,
        "not a ref line",
      ].join("\n"),
    );
    assert.equal(tags.get("v0.1.10"), "a".repeat(40));
    assert.equal(tags.get("v0.1.11"), "c".repeat(40));
    assert.equal(pickLatestStableTag(tags.keys()), "v0.1.11");
  });
});

describe("stripTagPrefix", () => {
  it("drops a leading v only", () => {
    assert.equal(stripTagPrefix("v0.1.12"), "0.1.12");
    assert.equal(stripTagPrefix("0.1.12"), "0.1.12");
  });
});

describe("scrubBuildEnv", () => {
  it("removes the update feed and signing variables and keeps the rest", () => {
    const scrubbed = scrubBuildEnv({
      PATH: "/usr/bin",
      HOME: "/Users/u",
      T3CODE_DESKTOP_UPDATE_REPOSITORY: "pingdotgg/t3code",
      GITHUB_REPOSITORY: "pingdotgg/t3code",
      CSC_LINK: "cert.p12",
      CSC_KEY_PASSWORD: "secret",
      APPLE_ID: "a@example.com",
      APPLE_APP_SPECIFIC_PASSWORD: "secret",
      APPLE_TEAM_ID: "TEAM",
      T3CODE_CLERK_PUBLISHABLE_KEY: "pk_test_x",
      UNSET: undefined,
    });
    assert.deepStrictEqual(scrubbed, {
      PATH: "/usr/bin",
      HOME: "/Users/u",
      T3CODE_CLERK_PUBLISHABLE_KEY: "pk_test_x",
    });
  });

  it("reads one key from a .env file", () => {
    const text = 'FOO=1\nexport T3CODE_CLERK_PUBLISHABLE_KEY="pk_test_abc"\nEMPTY=\n';
    assert.equal(readDotEnvValue(text, "T3CODE_CLERK_PUBLISHABLE_KEY"), "pk_test_abc");
    assert.equal(readDotEnvValue(text, "EMPTY"), undefined);
    assert.equal(readDotEnvValue(text, "MISSING"), undefined);
  });
});

describe("artifact assertions", () => {
  it.effect("assertNoUpdateFeed fails only when app-update.yml is present", () =>
    Effect.gen(function* () {
      yield* assertNoUpdateFeed(["app.asar", "icon.icns", "app-update.yml.bak"]);
      const error = yield* Effect.flip(assertNoUpdateFeed(["app.asar", "app-update.yml"]));
      assert.include(error.message, "app-update.yml");
    }),
  );

  it.effect("assertPickerBundled accepts asar paths with a leading separator", () =>
    Effect.gen(function* () {
      yield* assertPickerBundled([
        "/apps/desktop/dist-electron/main.cjs",
        "/apps/desktop/dist-electron/profile-picker.cjs",
        "/apps/desktop/dist-electron/profile-picker-preload.cjs",
      ]);
      const error = yield* Effect.flip(
        assertPickerBundled(["/apps/desktop/dist-electron/profile-picker.cjs"]),
      );
      assert.include(error.message, "profile-picker-preload.cjs");
      assert.notInclude(error.message, "profile-picker.cjs and");
    }),
  );
});

describe("backupRefName", () => {
  it("uses a UTC timestamp with no characters git refuses", () => {
    assert.equal(
      backupRefName(Date.UTC(2026, 10, 23, 10, 15, 0, 123)),
      "refs/fork-release/backup/20261123T101500Z",
    );
  });
});

describe("planSteps", () => {
  const input: PlanInput = {
    remote: "origin",
    branch: "profiles",
    tag: "v0.1.12",
    tagCommit: "t".repeat(40),
    base: "b".repeat(40),
    baseRecorded: true,
    relation: "descendant",
    rebase: true,
    install: false,
    backupRef: "refs/fork-release/backup/20261123T101500Z",
    outputDir: "/out",
    version: "0.1.12",
  };
  const ids = (overrides: Partial<PlanInput>) =>
    planSteps({ ...input, ...overrides }).map((s) => s.id);
  const rebaseIds = ["backup", "rebase", "move-base-tag"];
  const tail = ["install-deps", "check-changed", "focused-tests", "build", "verify"];

  it("plans the rebase only when the tag is newer than the base", () => {
    assert.deepStrictEqual(ids({}), [...rebaseIds, ...tail]);
    assert.deepStrictEqual(ids({ relation: "same" }), tail);
    assert.deepStrictEqual(ids({ relation: "other" }), tail);
    assert.deepStrictEqual(ids({ rebase: false }), tail);
  });

  it("marks the rebase conditional when the tag commit is not local", () => {
    const steps = planSteps({ ...input, relation: "unknown" });
    const rebase = steps.filter((step) => rebaseIds.includes(step.id));
    assert.deepStrictEqual(
      rebase.map((step) => step.id),
      rebaseIds,
    );
    assert.isTrue(rebase.every((step) => step.condition !== undefined));
    assert.include(steps.find((step) => step.id === "check-changed")?.description, "b".repeat(40));
  });

  it("creates the base tag on the first run and installs only when asked", () => {
    assert.deepStrictEqual(ids({ baseRecorded: false, relation: "other", install: true }), [
      "create-base-tag",
      ...tail,
      "install",
    ]);
  });

  it("lists every git write as one", () => {
    const steps = planSteps({ ...input, baseRecorded: false });
    assert.deepStrictEqual(
      steps.filter((step) => step.gitWrite).map((step) => step.id),
      ["create-base-tag", ...rebaseIds],
    );
    assert.include(steps.find((step) => step.id === "check-changed")?.description, "v0.1.12");
  });
});
