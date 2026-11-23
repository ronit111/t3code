// @effect-diagnostics globalDate:off - The launch decision takes a plain Date, so the table builds fixed ones.
import { assert, describe, it } from "@effect/vitest";

import type { ProfileLaunch } from "./ProfileContract.ts";
import { resolveProfileLaunchSync, type ProfileLaunchFileSystem } from "./ProfileLaunch.ts";

const HOME = "/Users/u";
const ROOT = "/Users/u/.t3-profiles";
const REGISTRY = `${ROOT}/profiles.json`;
const INTENT = `${ROOT}/launch-intent.json`;
const NOW = new Date("2026-11-23T10:06:00.000Z");
const P1 = "p7k2m9x4q1z";
const P2 = "pabcdefghij";
const LOCK = {
  kdf: "scrypt",
  N: 1024,
  r: 8,
  p: 1,
  keyLength: 64,
  salt: "c2FsdA==",
  hash: "aGFzaA==",
};

const fakeFs = (files: Record<string, string>) => {
  const contents = new Map(Object.entries(files));
  const calls: Array<string> = [];
  const fs: ProfileLaunchFileSystem = {
    exists: (path) => {
      calls.push(`exists ${path}`);
      return contents.has(path);
    },
    readFile: (path) => {
      calls.push(`readFile ${path}`);
      const text = contents.get(path);
      if (text === undefined) throw new Error("ENOENT");
      return text;
    },
    unlink: (path) => {
      calls.push(`unlink ${path}`);
      contents.delete(path);
    },
  };
  return { fs, calls, contents };
};

const registry = (
  profiles: ReadonlyArray<{ id: string; name?: string | null; lock?: unknown }>,
  extra: Record<string, unknown> = {},
) =>
  JSON.stringify({
    version: 1,
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name:
        profile.name === undefined ? (profile.id === "default" ? null : profile.id) : profile.name,
      createdAt: "2026-11-23T10:00:00.000Z",
      lock: profile.lock ?? null,
    })),
    ...extra,
  });

const intent = (target: unknown, createdAt: Date = NOW) =>
  JSON.stringify({ version: 1, createdAt: createdAt.toISOString(), target });

const resolve = (
  files: Record<string, string>,
  overrides: Partial<Parameters<typeof resolveProfileLaunchSync>[0]> = {},
) => {
  const fake = fakeFs(files);
  const launch = resolveProfileLaunchSync({
    argv: ["/Applications/T3 Code.app/Contents/MacOS/T3 Code"],
    env: {},
    platform: "darwin",
    homeDirectory: HOME,
    now: NOW,
    isDevelopment: false,
    fs: fake.fs,
    ...overrides,
  });
  return { launch, ...fake };
};

const openedId = (launch: ProfileLaunch) =>
  launch._tag === "Open" ? launch.profile.id : `picker:${launch.unlockProfileId ?? ""}`;

const seeded = (...ids: ReadonlyArray<string>) =>
  Object.fromEntries(ids.map((id) => [`${ROOT}/${id}/userdata/settings.json`, "{}"]));
const twoProfiles = { [REGISTRY]: registry([{ id: "default" }, { id: P1 }]), ...seeded(P1) };
const lockedP1 = {
  [REGISTRY]: registry([{ id: "default" }, { id: P1, lock: LOCK }]),
  ...seeded(P1),
};

describe("resolveProfileLaunchSync", () => {
  it.each([
    {
      step: "1: not macOS opens Default",
      files: twoProfiles,
      overrides: { platform: "linux" as const },
      expected: "default",
    },
    {
      step: "4: two profiles and nothing else shows the picker",
      files: twoProfiles,
      overrides: {},
      expected: "picker:",
    },
    {
      step: "4: an argument picks the profile",
      files: twoProfiles,
      overrides: { argv: ["app", `--t3-profile=${P1}`] },
      expected: P1,
    },
    {
      step: "4: the last argument wins",
      files: twoProfiles,
      overrides: { argv: ["app", `--t3-profile=${P1}`, "--t3-profile=default"] },
      expected: "default",
    },
    {
      step: "5: the picker argument shows the picker",
      files: { [REGISTRY]: registry([{ id: "default" }]) },
      overrides: { argv: ["app", "--t3-profile-picker"] },
      expected: "picker:",
    },
    {
      step: "7: a locked target without an intent opens the picker in unlock mode",
      files: lockedP1,
      overrides: { argv: ["app", `--t3-profile=${P1}`] },
      expected: `picker:${P1}`,
    },
    {
      step: "7: a locked Default without an intent opens the picker in unlock mode",
      files: { [REGISTRY]: registry([{ id: "default", lock: LOCK }]) },
      overrides: {},
      expected: "picker:default",
    },
    {
      step: "7: a locked target with a matching unlocked intent opens",
      files: {
        ...lockedP1,
        [INTENT]: intent({ kind: "profile", profileId: P1, unlocked: true }),
      },
      overrides: {},
      expected: P1,
    },
    {
      step: "7: a locked target with an intent that is not unlocked opens the picker in unlock mode",
      files: {
        ...lockedP1,
        [INTENT]: intent({ kind: "profile", profileId: P1, unlocked: false }),
      },
      overrides: {},
      expected: `picker:${P1}`,
    },
    {
      step: "7: an intent for another locked profile beats the argument and asks for its password",
      files: {
        [REGISTRY]: registry([{ id: "default" }, { id: P1, lock: LOCK }, { id: P2, lock: LOCK }]),
        ...seeded(P1, P2),
        [INTENT]: intent({ kind: "profile", profileId: P2, unlocked: false }),
      },
      overrides: { argv: ["app", `--t3-profile=${P1}`] },
      expected: `picker:${P2}`,
    },
    {
      step: "intent beats argument",
      files: {
        ...twoProfiles,
        [INTENT]: intent({ kind: "profile", profileId: P1, unlocked: true }),
      },
      overrides: { argv: ["app", "--t3-profile=default"] },
      expected: P1,
    },
    {
      step: "a picker intent beats an argument",
      files: { ...twoProfiles, [INTENT]: intent({ kind: "picker" }) },
      overrides: { argv: ["app", `--t3-profile=${P1}`] },
      expected: "picker:",
    },
    {
      step: "a stale intent (121 s) is ignored",
      files: {
        ...twoProfiles,
        [INTENT]: intent(
          { kind: "profile", profileId: P1, unlocked: true },
          new Date(NOW.getTime() - 121_000),
        ),
      },
      overrides: {},
      expected: "picker:",
    },
    {
      step: "a future intent (+6 s) is ignored",
      files: {
        ...twoProfiles,
        [INTENT]: intent(
          { kind: "profile", profileId: P1, unlocked: true },
          new Date(NOW.getTime() + 6_000),
        ),
      },
      overrides: {},
      expected: "picker:",
    },
    {
      step: "an intent of invalid JSON is ignored",
      files: { ...twoProfiles, [INTENT]: "{not json" },
      overrides: {},
      expected: "picker:",
    },
  ])("step $step", ({ files, overrides, expected }) => {
    assert.equal(openedId(resolve(files, overrides).launch), expected);
  });

  it("deletes every intent it finds, valid or not", () => {
    for (const text of [
      intent({ kind: "picker" }),
      intent({ kind: "picker" }, new Date(NOW.getTime() - 121_000)),
      "{not json",
    ]) {
      const { calls, contents } = resolve({ ...twoProfiles, [INTENT]: text });
      assert.isFalse(contents.has(INTENT));
      assert.include(calls, `unlink ${INTENT}`);
    }
  });

  it("step 6: an unknown id, or one whose home is gone, opens the picker with ProfileNotFound", () => {
    for (const [files, requestedId] of [
      [twoProfiles, "pzzzzzzzzzz"],
      [{ [REGISTRY]: twoProfiles[REGISTRY] }, P1],
    ] as const) {
      const { launch } = resolve(files, { argv: ["app", `--t3-profile=${requestedId}`] });
      assert.equal(launch._tag, "Picker");
      if (launch._tag !== "Picker") return;
      assert.deepEqual(launch.notice, { _tag: "ProfileNotFound", requestedId });
    }
  });

  it("step 3: a corrupt registry opens the picker even when an argument names Default", () => {
    for (const text of [
      "{not json",
      registry([{ id: "default" }, { id: "default" }]),
      registry([{ id: "default" }, { id: P1, name: "Work" }, { id: P2, name: "work" }]),
    ]) {
      const { launch } = resolve(
        {
          [REGISTRY]: text,
          [INTENT]: intent({ kind: "profile", profileId: "default", unlocked: true }),
        },
        { argv: ["app", "--t3-profile=default"] },
      );
      assert.equal(launch._tag, "Picker");
      if (launch._tag !== "Picker") return;
      assert.deepEqual(launch.notice, { _tag: "RegistryUnreadable", registryPath: REGISTRY });
    }
  });

  it("step 9: another profile opens with its own home and Electron userData", () => {
    const { launch } = resolve(twoProfiles, { argv: ["app", `--t3-profile=${P1}`] });
    assert.deepEqual<unknown>(launch, {
      _tag: "Open",
      profile: { id: P1, name: P1, isDefault: false, profilesRoot: ROOT, registryExists: true },
      home: `${ROOT}/${P1}`,
      userDataPath: `${HOME}/Library/Application Support/t3code-v2-profile-${P1}`,
    });
  });

  it("gives the picker its own userData and today's Default home", () => {
    const { launch } = resolve(twoProfiles, { env: { T3CODE_HOME: "/custom/home" } });
    assert.deepEqual<unknown>(launch, {
      _tag: "Picker",
      profilesRoot: ROOT,
      userDataPath: `${HOME}/Library/Application Support/t3code-v2-picker`,
      appDataDirectory: `${HOME}/Library/Application Support`,
      defaultHome: "/custom/home",
      isDevelopment: false,
      unlockProfileId: null,
      notice: { _tag: "None" },
    });
  });

  it.each([
    { name: "not macOS", overrides: { platform: "win32" as const } },
    {
      name: "development without T3CODE_PROFILES_HOME",
      overrides: { isDevelopment: true, env: { T3CODE_HOME: "/worktree/.t3" } },
    },
  ])("$name opens Default with no file access at all", ({ overrides }) => {
    const { launch, calls } = resolve(twoProfiles, overrides);
    assert.deepEqual<unknown>(launch, {
      _tag: "Open",
      profile: {
        id: "default",
        name: null,
        isDefault: true,
        profilesRoot: null,
        registryExists: false,
      },
      home: null,
      userDataPath: null,
    });
    assert.deepEqual(calls, []);
  });

  it("honours T3CODE_PROFILES_HOME, in development too", () => {
    const root = "/worktree/.t3/profiles-test";
    const { launch } = resolve(
      {
        [`${root}/profiles.json`]: registry([{ id: "default" }, { id: P1 }]),
        [`${root}/${P1}/userdata/settings.json`]: "{}",
      },
      {
        isDevelopment: true,
        env: { T3CODE_PROFILES_HOME: root },
        argv: ["app", `--t3-profile=${P1}`],
      },
    );
    assert.deepEqual(launch._tag === "Open" ? launch.home : null, `${root}/${P1}`);
    assert.deepEqual(
      launch._tag === "Open" ? launch.userDataPath : null,
      `${HOME}/Library/Application Support/t3code-dev-profile-${P1}`,
    );
  });

  it("lets T3CODE_HOME move only the Default home, never the profiles root", () => {
    const { launch } = resolve(twoProfiles, {
      env: { T3CODE_HOME: "/custom/home" },
      argv: ["app", `--t3-profile=${P1}`],
    });
    assert.equal(launch._tag === "Open" ? launch.home : null, `${ROOT}/${P1}`);
  });

  it("5.3: no registry opens Default and writes nothing", () => {
    const { launch, calls } = resolve({});
    assert.deepEqual<unknown>(launch, {
      _tag: "Open",
      profile: {
        id: "default",
        name: null,
        isDefault: true,
        profilesRoot: ROOT,
        registryExists: false,
      },
      home: null,
      userDataPath: null,
    });
    assert.deepEqual(calls, [`exists ${INTENT}`, `exists ${REGISTRY}`]);
  });

  it("5.4: a registry with only an unlocked Default opens Default and writes nothing", () => {
    const { launch, calls } = resolve({
      [REGISTRY]: registry([{ id: "default", name: "Travel" }]),
    });
    assert.deepEqual<unknown>(launch, {
      _tag: "Open",
      profile: {
        id: "default",
        name: "Travel",
        isDefault: true,
        profilesRoot: ROOT,
        registryExists: true,
      },
      home: null,
      userDataPath: null,
    });
    assert.deepEqual(calls, [`exists ${INTENT}`, `exists ${REGISTRY}`, `readFile ${REGISTRY}`]);
  });
});
