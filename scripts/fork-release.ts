#!/usr/bin/env node
// `vp run fork:release --dry-run` prints the plan and writes nothing. The real run rebases the
// profiles branch onto the newest stable tag, checks, builds and verifies an updates-off app;
// --install replaces the app in /Applications. A rebase conflict exits 2 with the branch reset.
import { listPackage } from "@electron/asar";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export class ForkReleaseError extends Schema.TaggedError<ForkReleaseError>()("ForkReleaseError", {
  reason: Schema.String,
}) {
  override get message(): string {
    return this.reason;
  }
}

export class ForkReleaseConflictError extends Schema.TaggedError<ForkReleaseConflictError>()(
  "ForkReleaseConflictError",
  {
    tag: Schema.String,
    files: Schema.Array(Schema.String),
    backupRef: Schema.String,
  },
) {
  override get message(): string {
    const files = this.files.length > 0 ? this.files.join(", ") : "(git listed no files)";
    return `Rebase onto ${this.tag} stopped on conflicts in: ${files}. The branch is back at ${this.backupRef}.`;
  }
}

const fail = (reason: string) => Effect.fail(new ForkReleaseError({ reason }));

const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

const SCRUBBED_BUILD_ENV_KEYS = [
  "T3CODE_DESKTOP_UPDATE_REPOSITORY",
  "GITHUB_REPOSITORY",
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
] as const;

const PICKER_BUNDLE_FILES = [
  "apps/desktop/dist-electron/profile-picker.cjs",
  "apps/desktop/dist-electron/profile-picker-preload.cjs",
] as const;

const REQUIRED_TOOLS = ["git", "vp", "hdiutil", "codesign", "ditto", "plutil", "shasum"] as const;
const INSTALL_TOOLS = ["lsappinfo", "xattr"] as const;

// Every test file the profiles spec names for the core, picker and connectors lanes.
export const FOCUSED_TEST_FILES = [
  "apps/desktop/src/profiles/ProfileLaunch.test.ts",
  "apps/desktop/src/profiles/ProfileRegistry.test.ts",
  "apps/desktop/src/profiles/ProfileLock.test.ts",
  "apps/desktop/src/profiles/ProfileSeed.test.ts",
  "apps/desktop/src/profiles/ProfileServiceLive.test.ts",
  "apps/desktop/src/profiles/ProfileRelaunch.test.ts",
  "apps/desktop/src/profiles/ProfileSwitch.test.ts",
  "apps/desktop/src/app/DesktopEnvironment.test.ts",
  "apps/desktop/src/app/DesktopUserData.test.ts",
  "apps/desktop/src/app/DesktopLifecycle.test.ts",
  "apps/desktop/src/app/DesktopCliCommand.test.ts",
  "apps/desktop/src/backend/DesktopHomeOwner.test.ts",
  "apps/desktop/src/profiles/picker/ProfilePickerState.test.ts",
  "apps/desktop/src/profiles/picker/ProfilePickerIpc.test.ts",
  "apps/desktop/src/profiles/picker/ProfilePickerProgram.test.ts",
  "apps/desktop/src/ipc/methods/profiles.test.ts",
  "apps/desktop/src/window/DesktopApplicationMenu.test.ts",
  "apps/server/src/provider/ClaudeMcpServers.test.ts",
  "apps/server/src/auth/RpcAuthorization.test.ts",
  "packages/client-runtime/src/state/commandPermissions.test.ts",
  "packages/contracts/src/claudeConnectors.test.ts",
  "apps/web/src/components/settings/ConnectorsSettings.logic.test.ts",
  "scripts/fork-release.test.ts",
] as const;

export const stripTagPrefix = (tag: string): string => (tag.startsWith("v") ? tag.slice(1) : tag);

const parseStableTag = (tag: string): readonly [number, number, number] | undefined => {
  const match = STABLE_TAG.exec(tag);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

export const sortStableTags = (tags: Iterable<string>): ReadonlyArray<string> =>
  [...new Set(tags)]
    .flatMap((tag) => {
      const version = parseStableTag(tag);
      return version ? [{ tag, version }] : [];
    })
    .toSorted(
      (left, right) =>
        left.version[0] - right.version[0] ||
        left.version[1] - right.version[1] ||
        left.version[2] - right.version[2],
    )
    .map((entry) => entry.tag);

export const pickLatestStableTag = (tags: Iterable<string>): string | undefined =>
  sortStableTags(tags).at(-1);

// `git ls-remote --tags` lists an annotated tag twice; the `^{}` line carries the commit.
export const parseLsRemoteTags = (output: string): ReadonlyMap<string, string> => {
  const commits = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^([0-9a-f]{40})\s+refs\/tags\/(.+?)(\^\{\})?$/.exec(line.trim());
    if (!match) continue;
    const [, sha, tag, peeled] = match;
    if (!sha || !tag) continue;
    if (peeled || !commits.has(tag)) commits.set(tag, sha);
  }
  return commits;
};

export const scrubBuildEnv = (
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const scrubbed: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if ((SCRUBBED_BUILD_ENV_KEYS as ReadonlyArray<string>).includes(key)) continue;
    scrubbed[key] = value;
  }
  return scrubbed;
};

export const readDotEnvValue = (text: string, key: string): string | undefined => {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || match[1] !== key) continue;
    const value = (match[2] ?? "").trim().replace(/^(["'])(.*)\1$/, "$2");
    return value.length > 0 ? value : undefined;
  }
  return undefined;
};

export const assertNoUpdateFeed = (resourcesListing: ReadonlyArray<string>) =>
  resourcesListing.some((entry) => entry.split(/[\\/]/).at(-1) === "app-update.yml")
    ? fail(
        "Contents/Resources/app-update.yml is in the built app, so it would update itself to stock.",
      )
    : Effect.void;

export const assertPickerBundled = (asarListing: ReadonlyArray<string>) => {
  const entries = new Set(
    asarListing.map((entry) => entry.replaceAll("\\", "/").replace(/^\/+/, "")),
  );
  const missing = PICKER_BUNDLE_FILES.filter((file) => !entries.has(file));
  return missing.length > 0
    ? fail(`app.asar is missing ${missing.join(" and ")}. Check DESKTOP_FILE_EXCLUSIONS.`)
    : Effect.void;
};

export const backupRefName = (epochMillis: number): string =>
  `refs/fork-release/backup/${DateTime.formatIso(DateTime.makeUnsafe(epochMillis))
    .replace(/\.\d{3}Z$/, "Z")
    .replaceAll(/[-:]/g, "")}`;

export const baseTagName = (branch: string): string => `fork-base/${branch}`;

export type BaseRelation = "same" | "descendant" | "other" | "unknown";

export type StepId =
  | "create-base-tag"
  | "backup"
  | "rebase"
  | "move-base-tag"
  | "install-deps"
  | "check-changed"
  | "focused-tests"
  | "build"
  | "verify"
  | "install";

export interface PlannedStep {
  readonly id: StepId;
  readonly description: string;
  readonly gitWrite: boolean;
  readonly condition?: string;
}

export interface PlanInput {
  readonly remote: string;
  readonly branch: string;
  readonly tag: string;
  readonly tagCommit: string;
  readonly base: string;
  readonly baseRecorded: boolean;
  readonly relation: BaseRelation;
  readonly rebase: boolean;
  readonly install: boolean;
  readonly backupRef: string;
  readonly outputDir: string;
  readonly version: string;
}

export const planSteps = (input: PlanInput): ReadonlyArray<PlannedStep> => {
  const steps: Array<PlannedStep> = [];
  const baseTag = baseTagName(input.branch);
  if (!input.baseRecorded) {
    steps.push({
      id: "create-base-tag",
      description: `git tag ${baseTag} ${input.base} (merge base of ${input.branch} and ${input.remote}/main)`,
      gitWrite: true,
    });
  }

  const rebaseCondition =
    input.relation === "unknown"
      ? `only if ${input.tag} is newer than the base; the real run fetches the tag to decide`
      : undefined;
  const plansRebase =
    input.rebase && (input.relation === "descendant" || input.relation === "unknown");
  if (plansRebase) {
    const conditional = rebaseCondition ? { condition: rebaseCondition } : {};
    steps.push(
      {
        id: "backup",
        description: `git update-ref ${input.backupRef} ${input.branch}`,
        gitWrite: true,
        ...conditional,
      },
      {
        id: "rebase",
        description: `git rebase --onto ${input.tagCommit} ${input.base} ${input.branch} (${input.tag})`,
        gitWrite: true,
        ...conditional,
      },
      {
        id: "move-base-tag",
        description: `git tag -f ${baseTag} ${input.tagCommit}`,
        gitWrite: true,
        ...conditional,
      },
    );
  }

  const checkRef = plansRebase && input.relation === "descendant" ? input.tag : input.base;
  steps.push(
    { id: "install-deps", description: "vp i", gitWrite: false },
    { id: "check-changed", description: `vp run check:changed ${checkRef}`, gitWrite: false },
    {
      id: "focused-tests",
      description: `vp test run (${FOCUSED_TEST_FILES.length} profile, picker, connector and release test files)`,
      gitWrite: false,
    },
    {
      id: "build",
      description: `node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch arm64 --build-version ${input.version} --output-dir ${input.outputDir} (update feed and signing variables removed)`,
      gitWrite: false,
    },
    {
      id: "verify",
      description:
        "mount the DMG; app-update.yml absent; bundle version; picker files in app.asar; ad-hoc sign a copy and codesign --verify",
      gitWrite: false,
    },
  );
  if (input.install) {
    steps.push({
      id: "install",
      description:
        "refuse while the app runs; move the old app to ~/.Trash; ditto the signed copy into /Applications; clear quarantine",
      gitWrite: false,
    });
  }
  return steps;
};

export const describeRelation = (input: {
  readonly tag: string;
  readonly relation: BaseRelation;
  readonly rebase: boolean;
}): string => {
  switch (input.relation) {
    case "same":
      return `Already on ${input.tag}; no rebase.`;
    case "descendant":
      return input.rebase
        ? `${input.tag} is newer than the fork base; rebasing onto it.`
        : `${input.tag} is newer than the fork base, but --no-rebase keeps the current base.`;
    case "other":
      return `Latest stable ${input.tag} is older than the fork base; building the current base.`;
    case "unknown":
      return `${input.tag} is not in the local repository yet; the real run fetches it and then decides whether to rebase.`;
  }
};

interface RunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunOptions {
  readonly cwd: string;
  readonly env?: Record<string, string>;
  readonly inherit?: boolean;
}

const collectText = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const run = Effect.fn("ForkRelease.run")(
  function* (command: string, args: ReadonlyArray<string>, options: RunOptions) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const output = options.inherit ? "inherit" : "pipe";
    const child = yield* spawner.spawn(
      ChildProcess.make(command, args, {
        cwd: options.cwd,
        ...(options.env ? { env: options.env } : {}),
        stdin: "ignore",
        stdout: output,
        stderr: output,
      }),
    );
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        options.inherit ? Effect.succeed("") : collectText(child.stdout),
        options.inherit ? Effect.succeed("") : collectText(child.stderr),
        child.exitCode,
      ],
      { concurrency: "unbounded" },
    );
    return { exitCode: Number(exitCode), stdout, stderr } satisfies RunResult;
  },
  Effect.scoped,
  Effect.mapError(
    (cause) => new ForkReleaseError({ reason: `Could not run a command: ${String(cause)}` }),
  ),
);

const runChecked = Effect.fn("ForkRelease.runChecked")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions,
) {
  const result = yield* run(command, args, options);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim().split(/\r?\n/).at(-1);
    return yield* fail(
      `${[command, ...args].join(" ")} exited with code ${result.exitCode}${detail ? `: ${detail}` : ""}`,
    );
  }
  return result.stdout.trim();
});

const git = (repoRoot: string, args: ReadonlyArray<string>) =>
  runChecked("git", args, { cwd: repoRoot });

const findMissingTools = Effect.fn("ForkRelease.findMissingTools")(function* (
  tools: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const env = yield* HostProcess.Environment;
  const dirs = (env.PATH ?? "").split(":").filter((dir) => dir.length > 0);
  const missing: Array<string> = [];
  for (const tool of tools) {
    let found = false;
    for (const dir of dirs) {
      if (yield* fs.exists(path.join(dir, tool)).pipe(Effect.orElseSucceed(() => false))) {
        found = true;
        break;
      }
    }
    if (!found) missing.push(tool);
  }
  return missing;
});

export const checkPreconditions = Effect.fn("ForkRelease.checkPreconditions")(function* (input: {
  readonly repoRoot: string;
  readonly branch: string;
  readonly install: boolean;
}) {
  const missing = yield* findMissingTools(
    input.install ? [...REQUIRED_TOOLS, ...INSTALL_TOOLS] : REQUIRED_TOOLS,
  );
  if (missing.length > 0) {
    return yield* fail(`Not on PATH: ${missing.join(", ")}.`);
  }
  const current = yield* run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
    cwd: input.repoRoot,
  });
  const currentBranch = current.stdout.trim();
  if (current.exitCode !== 0 || currentBranch !== input.branch) {
    return yield* fail(
      `Check out ${input.branch} first (on ${currentBranch.length > 0 ? currentBranch : "a detached HEAD"}).`,
    );
  }
  const status = yield* git(input.repoRoot, ["status", "--porcelain"]);
  if (status.length > 0) {
    return yield* fail(`The worktree has uncommitted changes. Commit or stash them first.`);
  }
});

const commitExists = (repoRoot: string, ref: string) =>
  run("git", ["cat-file", "-e", `${ref}^{commit}`], { cwd: repoRoot }).pipe(
    Effect.map((result) => result.exitCode === 0),
  );

const resolveCommit = Effect.fn("ForkRelease.resolveCommit")(function* (
  repoRoot: string,
  ref: string,
) {
  const result = yield* run("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    cwd: repoRoot,
  });
  return result.exitCode === 0 ? Option.some(result.stdout.trim()) : Option.none<string>();
});

const resolveRelation = Effect.fn("ForkRelease.resolveRelation")(function* (
  repoRoot: string,
  base: string,
  tagCommit: string,
) {
  if (base === tagCommit) return "same" as const;
  if (!(yield* commitExists(repoRoot, tagCommit))) return "unknown" as const;
  const ancestor = yield* run("git", ["merge-base", "--is-ancestor", base, tagCommit], {
    cwd: repoRoot,
  });
  if (ancestor.exitCode === 0) return "descendant" as const;
  if (ancestor.exitCode === 1) return "other" as const;
  return yield* fail(`git merge-base --is-ancestor ${base} ${tagCommit} failed.`);
});

const listStableTags = Effect.fn("ForkRelease.listStableTags")(function* (input: {
  readonly repoRoot: string;
  readonly remote: string;
  readonly dryRun: boolean;
}) {
  if (input.dryRun) {
    const output = yield* git(input.repoRoot, ["ls-remote", "--tags", input.remote]);
    const commits = parseLsRemoteTags(output);
    return { tags: sortStableTags(commits.keys()), commitOf: (tag: string) => commits.get(tag) };
  }
  yield* runChecked("git", ["fetch", input.remote, "--tags", "--no-recurse-submodules"], {
    cwd: input.repoRoot,
    inherit: true,
  });
  const output = yield* git(input.repoRoot, ["tag", "--list", "v*"]);
  return { tags: sortStableTags(output.split(/\r?\n/)), commitOf: () => undefined };
});

export const resolveBase = Effect.fn("ForkRelease.resolveBase")(function* (input: {
  readonly repoRoot: string;
  readonly remote: string;
  readonly branch: string;
}) {
  const recorded = yield* resolveCommit(input.repoRoot, `refs/tags/${baseTagName(input.branch)}`);
  if (Option.isSome(recorded)) {
    return { base: recorded.value, baseRecorded: true };
  }
  const mergeBase = yield* git(input.repoRoot, [
    "merge-base",
    input.branch,
    `${input.remote}/main`,
  ]);
  return { base: mergeBase, baseRecorded: false };
});

export const rebaseOntoTag = Effect.fn("ForkRelease.rebaseOntoTag")(function* (input: {
  readonly repoRoot: string;
  readonly branch: string;
  readonly tag: string;
  readonly tagCommit: string;
  readonly base: string;
  readonly backupRef: string;
}) {
  const rebase = yield* run(
    "git",
    ["rebase", "--onto", input.tagCommit, input.base, input.branch],
    {
      cwd: input.repoRoot,
    },
  );
  if (rebase.exitCode !== 0) {
    const conflicts = yield* run("git", ["diff", "--name-only", "--diff-filter=U"], {
      cwd: input.repoRoot,
    });
    yield* run("git", ["rebase", "--abort"], { cwd: input.repoRoot });
    yield* git(input.repoRoot, ["reset", "--hard", input.backupRef]);
    return yield* new ForkReleaseConflictError({
      tag: input.tag,
      files: conflicts.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
      backupRef: input.backupRef,
    });
  }
});

const decodePackageVersion = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
);

const readDesktopVersion = Effect.fn("ForkRelease.readDesktopVersion")(function* (
  repoRoot: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fs
    .readFileString(path.join(repoRoot, "apps/desktop/package.json"))
    .pipe(
      Effect.mapError(
        () => new ForkReleaseError({ reason: "Cannot read apps/desktop/package.json." }),
      ),
    );
  const version = yield* decodePackageVersion(text).pipe(
    Effect.mapError(
      () => new ForkReleaseError({ reason: "apps/desktop/package.json has no version." }),
    ),
  );
  return version.version;
});

const defaultOutputDir = Effect.fn("ForkRelease.defaultOutputDir")(function* (version: string) {
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  return path.join(home, "Library/Caches/t3code-fork-release", version);
});

const resolveClerkKey = Effect.fn("ForkRelease.resolveClerkKey")(function* (repoRoot: string) {
  const env = yield* HostProcess.Environment;
  const fromEnv = env.T3CODE_CLERK_PUBLISHABLE_KEY?.trim();
  if (fromEnv) return Option.some(fromEnv);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dotEnv = yield* fs
    .readFileString(path.join(repoRoot, ".env"))
    .pipe(Effect.orElseSucceed(() => ""));
  return Option.fromUndefinedOr(readDotEnvValue(dotEnv, "T3CODE_CLERK_PUBLISHABLE_KEY"));
});

const buildApp = Effect.fn("ForkRelease.buildApp")(function* (input: {
  readonly repoRoot: string;
  readonly version: string;
  readonly outputDir: string;
}) {
  const env = yield* HostProcess.Environment;
  const execPath = yield* HostProcess.ExecutablePath;
  const clerkKey = yield* resolveClerkKey(input.repoRoot);
  if (Option.isNone(clerkKey)) {
    yield* Console.warn(
      "fork-release: T3CODE_CLERK_PUBLISHABLE_KEY is not set, so T3 Connect sign-in is unavailable in this build.",
    );
  }
  const buildEnv = scrubBuildEnv({
    ...env,
    ...(Option.isSome(clerkKey) ? { T3CODE_CLERK_PUBLISHABLE_KEY: clerkKey.value } : {}),
  });
  yield* runChecked(
    execPath,
    [
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "mac",
      "--target",
      "dmg",
      "--arch",
      "arm64",
      "--build-version",
      input.version,
      "--output-dir",
      input.outputDir,
    ],
    { cwd: input.repoRoot, env: buildEnv, inherit: true },
  );
});

const verifyArtifact = Effect.fn("ForkRelease.verifyArtifact")(function* (input: {
  readonly repoRoot: string;
  readonly version: string;
  readonly outputDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const cwd = input.repoRoot;
  const dmg = path.join(input.outputDir, `T3-Code-${input.version}-arm64.dmg`);
  if (!(yield* fs.exists(dmg))) {
    return yield* fail(`The build did not produce ${dmg}.`);
  }

  const mountPoint = yield* fs.makeTempDirectoryScoped({ prefix: "t3code-fork-release-" });
  yield* Effect.acquireRelease(
    runChecked("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmg], {
      cwd,
    }),
    () => run("hdiutil", ["detach", mountPoint], { cwd }).pipe(Effect.ignore),
  );

  const appName = (yield* fs.readDirectory(mountPoint)).find((entry) => entry.endsWith(".app"));
  if (!appName) {
    return yield* fail(`No .app in ${dmg}.`);
  }
  const mountedApp = path.join(mountPoint, appName);
  const checks: Array<string> = [];

  yield* assertNoUpdateFeed(yield* fs.readDirectory(path.join(mountedApp, "Contents/Resources")));
  checks.push("no update feed");

  const bundleVersion = yield* runChecked(
    "plutil",
    [
      "-extract",
      "CFBundleShortVersionString",
      "raw",
      "-o",
      "-",
      path.join(mountedApp, "Contents/Info.plist"),
    ],
    { cwd },
  );
  if (bundleVersion !== input.version) {
    return yield* fail(
      `CFBundleShortVersionString is ${bundleVersion}, expected ${input.version}.`,
    );
  }
  checks.push("bundle version");

  const asarPath = path.join(mountedApp, "Contents/Resources/app.asar");
  const asarListing = yield* Effect.try({
    try: () => listPackage(asarPath, { isPack: false }),
    catch: () => new ForkReleaseError({ reason: `Cannot read ${asarPath}.` }),
  });
  yield* assertPickerBundled(asarListing);
  checks.push("picker bundled");

  const signedDir = path.join(input.outputDir, "signed");
  const signedApp = path.join(signedDir, appName);
  yield* fs.remove(signedDir, { recursive: true, force: true }).pipe(Effect.orDie);
  yield* fs.makeDirectory(signedDir, { recursive: true }).pipe(Effect.orDie);
  yield* runChecked("ditto", [mountedApp, signedApp], { cwd });
  yield* runChecked("codesign", ["--force", "--deep", "--sign", "-", signedApp], { cwd });
  yield* runChecked("codesign", ["--verify", "--deep", "--strict", signedApp], { cwd });
  checks.push("ad-hoc codesign");

  const shasum = yield* runChecked("shasum", ["-a", "256", dmg], { cwd });
  return {
    artifact: dmg,
    sha256: shasum.split(/\s+/)[0] ?? "",
    appName,
    signedApp,
    checks,
  };
}, Effect.scoped);

const installApp = Effect.fn("ForkRelease.installApp")(function* (input: {
  readonly repoRoot: string;
  readonly appName: string;
  readonly signedApp: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const cwd = input.repoRoot;
  const displayName = input.appName.replace(/\.app$/, "");

  const running = yield* runChecked("lsappinfo", ["find", `name=${displayName}`], { cwd });
  if (running.length > 0) {
    return yield* fail(`${displayName} is running. Quit it, then run --install again.`);
  }

  const target = path.join("/Applications", input.appName);
  if (yield* fs.exists(target)) {
    const stamp = backupRefName(yield* Clock.currentTimeMillis)
      .split("/")
      .at(-1);
    const trashed = path.join(home, ".Trash", `${displayName} ${stamp}.app`);
    yield* fs
      .rename(target, trashed)
      .pipe(
        Effect.mapError(
          () => new ForkReleaseError({ reason: `Cannot move ${target} to the Trash.` }),
        ),
      );
  }
  yield* runChecked("ditto", [input.signedApp, target], { cwd });
  yield* runChecked("xattr", ["-dr", "com.apple.quarantine", target], { cwd });
});

const ReleaseReport = Schema.Struct({
  dryRun: Schema.optionalKey(Schema.Literal(true)),
  tag: Schema.String,
  base: Schema.String,
  rebased: Schema.Boolean,
  commits: Schema.Number,
  checks: Schema.Array(Schema.String),
  artifact: Schema.NullOr(Schema.String),
  sha256: Schema.NullOr(Schema.String),
  installed: Schema.Boolean,
});

const encodeReleaseReport = Schema.encodeEffect(Schema.fromJsonString(ReleaseReport));

const printReport = Effect.fn("ForkRelease.printReport")(function* (
  report: typeof ReleaseReport.Type,
) {
  const line = yield* encodeReleaseReport(report).pipe(
    Effect.mapError(() => new ForkReleaseError({ reason: "Cannot encode the release report." })),
  );
  yield* Console.log(line);
});

interface ReleaseOptions {
  readonly remote: string;
  readonly branch: string;
  readonly tag: Option.Option<string>;
  readonly rebase: boolean;
  readonly outputDir: Option.Option<string>;
  readonly install: boolean;
  readonly dryRun: boolean;
}

const forkRelease = Effect.fn("ForkRelease.release")(function* (options: ReleaseOptions) {
  const path = yield* Path.Path;
  const repoRoot = yield* path.fromFileUrl(new URL("..", import.meta.url));

  yield* checkPreconditions({ repoRoot, branch: options.branch, install: options.install });

  const listed = yield* listStableTags({
    repoRoot,
    remote: options.remote,
    dryRun: options.dryRun,
  });
  const tag = Option.isSome(options.tag) ? options.tag.value : pickLatestStableTag(listed.tags);
  if (!tag) {
    return yield* fail(`${options.remote} has no stable vX.Y.Z tag.`);
  }
  if (!listed.tags.includes(tag)) {
    return yield* fail(`${tag} is not a stable tag on ${options.remote}.`);
  }

  const tagCommit = options.dryRun
    ? listed.commitOf(tag)
    : Option.getOrUndefined(yield* resolveCommit(repoRoot, `refs/tags/${tag}`));
  if (!tagCommit) {
    return yield* fail(`Cannot resolve the commit of ${tag}.`);
  }

  const { base, baseRecorded } = yield* resolveBase({
    repoRoot,
    remote: options.remote,
    branch: options.branch,
  });
  const relation = yield* resolveRelation(repoRoot, base, tagCommit);
  if (relation === "unknown" && !options.dryRun) {
    return yield* fail(`The fetch did not bring ${tag}'s commit ${tagCommit}.`);
  }
  const currentVersion = yield* readDesktopVersion(repoRoot);
  const backupRef = backupRefName(yield* Clock.currentTimeMillis);
  const plan = planSteps({
    remote: options.remote,
    branch: options.branch,
    tag,
    tagCommit,
    base,
    baseRecorded,
    relation,
    rebase: options.rebase,
    install: options.install,
    backupRef,
    outputDir: Option.isSome(options.outputDir)
      ? options.outputDir.value
      : yield* defaultOutputDir(currentVersion),
    version: currentVersion,
  });

  yield* Console.log(
    `fork-release${options.dryRun ? " (dry run)" : ""}: ${options.branch} on ${options.remote}, tag ${tag}`,
  );
  yield* Console.log(
    `  base ${base}${baseRecorded ? ` (${baseTagName(options.branch)})` : ` (new: merge base of ${options.branch} and ${options.remote}/main)`}`,
  );
  yield* Console.log(`  ${describeRelation({ tag, relation, rebase: options.rebase })}`);
  if (options.dryRun) {
    yield* Console.log(
      `  [git write, skipped] git fetch ${options.remote} --tags --no-recurse-submodules (the dry run read git ls-remote instead)`,
    );
  }
  for (const [index, step] of plan.entries()) {
    const marks = [...(step.gitWrite ? ["git write"] : []), ...(options.dryRun ? ["skipped"] : [])];
    yield* Console.log(
      `  ${index + 1}. ${marks.length > 0 ? `[${marks.join(", ")}] ` : ""}${step.description}${step.condition ? ` (${step.condition})` : ""}`,
    );
  }

  const commitsOnTop = (from: string) =>
    git(repoRoot, ["rev-list", "--count", `${from}..${options.branch}`]).pipe(Effect.map(Number));

  if (options.dryRun) {
    yield* printReport({
      dryRun: true,
      tag,
      base,
      rebased: false,
      commits: yield* commitsOnTop(base),
      checks: [],
      artifact: null,
      sha256: null,
      installed: false,
    });
    return;
  }

  let finalBase = base;
  let rebased = false;
  const checks: Array<string> = [];
  let version = currentVersion;
  let outputDir = "";
  let verified: Effect.Success<ReturnType<typeof verifyArtifact>> | undefined;
  let installed = false;

  for (const step of plan) {
    switch (step.id) {
      case "create-base-tag":
        yield* git(repoRoot, ["tag", baseTagName(options.branch), base]);
        break;
      case "backup":
        yield* git(repoRoot, ["update-ref", backupRef, options.branch]);
        break;
      case "rebase":
        yield* rebaseOntoTag({ repoRoot, branch: options.branch, tag, tagCommit, base, backupRef });
        finalBase = tagCommit;
        rebased = true;
        version = yield* readDesktopVersion(repoRoot);
        break;
      case "move-base-tag":
        yield* git(repoRoot, ["tag", "-f", baseTagName(options.branch), tagCommit]);
        break;
      case "install-deps":
        yield* runChecked("vp", ["i"], { cwd: repoRoot, inherit: true });
        break;
      case "check-changed":
        yield* runChecked("vp", ["run", "check:changed", finalBase], {
          cwd: repoRoot,
          inherit: true,
        });
        checks.push("check:changed");
        break;
      case "focused-tests":
        yield* runChecked("vp", ["test", "run", ...FOCUSED_TEST_FILES], {
          cwd: repoRoot,
          inherit: true,
        });
        checks.push("focused tests");
        break;
      case "build":
        outputDir = Option.isSome(options.outputDir)
          ? options.outputDir.value
          : yield* defaultOutputDir(version);
        yield* buildApp({ repoRoot, version, outputDir });
        break;
      case "verify":
        verified = yield* verifyArtifact({ repoRoot, version, outputDir });
        checks.push(...verified.checks);
        break;
      case "install":
        if (!verified) return yield* fail("Nothing was verified to install.");
        yield* installApp({ repoRoot, appName: verified.appName, signedApp: verified.signedApp });
        installed = true;
        break;
    }
  }

  yield* printReport({
    tag,
    base: finalBase,
    rebased,
    commits: yield* commitsOnTop(finalBase),
    checks,
    artifact: verified?.artifact ?? null,
    sha256: verified?.sha256 ?? null,
    installed,
  });
});

const forkReleaseCommand = Command.make(
  "fork-release",
  {
    remote: Flag.String("upstream-remote").pipe(
      Flag.withDescription("Remote that carries upstream's tags and main."),
      Flag.withDefault("origin"),
    ),
    branch: Flag.String("branch").pipe(
      Flag.withDescription("The fork branch to rebase and build."),
      Flag.withDefault("profiles"),
    ),
    tag: Flag.String("tag").pipe(
      Flag.withDescription("Stable tag to move onto (default: the latest stable vX.Y.Z)."),
      Flag.optional,
    ),
    rebase: Flag.Boolean("rebase").pipe(
      Flag.withDescription("Rebase onto a newer tag. --no-rebase builds the current base."),
      Flag.withDefault(true),
    ),
    outputDir: Flag.String("output-dir").pipe(
      Flag.withDescription(
        "Artifact folder (default: ~/Library/Caches/t3code-fork-release/<version>).",
      ),
      Flag.optional,
    ),
    install: Flag.Boolean("install").pipe(
      Flag.withDescription("Replace the app in /Applications with the verified build."),
      Flag.withDefault(false),
    ),
    dryRun: Flag.Boolean("dry-run").pipe(
      Flag.withDescription("Print the plan. No git writes, no install, no build."),
      Flag.withDefault(false),
    ),
  },
  (options) =>
    forkRelease(options).pipe(
      // exitCode, not a failed exit: runMain would print a stack instead of one line.
      Effect.catch((error) =>
        Console.error(`fork-release: ${error.message}`).pipe(
          Effect.andThen(
            Effect.sync(() => {
              process.exitCode = error._tag === "ForkReleaseConflictError" ? 2 : 1;
            }),
          ),
        ),
      ),
    ),
).pipe(Command.withDescription("Rebase, check, build and install the profiles fork."));

if (import.meta.main) {
  Command.run(forkReleaseCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
