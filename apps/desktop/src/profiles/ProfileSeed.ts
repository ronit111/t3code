import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { msg } from "gt-i18n";

import { m } from "../i18n/messages.ts";
import { profileHome } from "./ProfilePaths.ts";
import {
  ioError,
  PRIVATE_DIRECTORY_MODE,
  writeFileAtomic,
  type ProfileEntry,
  writeProfileMirror,
} from "./ProfileRegistry.ts";

// Instance ids equal the driver's default instance id, so they replace the shared-home defaults.
const seededServerSettings = (home: string, joinPath: Path.Path["join"]) => ({
  providerInstances: {
    claudeAgent: {
      driver: "claudeAgent",
      config: { homePath: joinPath(home, "providers", "claude") },
    },
    codex: {
      driver: "codex",
      config: { homePath: joinPath(home, "providers", "codex") },
    },
  },
});

const SEEDED_CLAUDE_SETTINGS = { disableClaudeAiConnectors: true } as const;

const toJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Creates `<root>/<id>` as a full T3 home. The caller writes the registry last. */
export const seedProfileHome = Effect.fn("DesktopProfiles.seedProfileHome")(function* (
  profilesRoot: string,
  entry: ProfileEntry,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const failed = () => ioError(m(msg("T3 Code could not create the profile folder.")), entry.id);
  const home = path.resolve(profileHome(profilesRoot, entry.id, path.join));
  yield* fs
    .makeDirectory(profilesRoot, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    .pipe(Effect.mapError(failed));
  // Non-recursive, so an existing folder fails instead of being reused.
  yield* fs.makeDirectory(home, { mode: PRIVATE_DIRECTORY_MODE }).pipe(Effect.mapError(failed));
  for (const directory of [
    path.join(home, "userdata"),
    path.join(home, "providers", "claude"),
    path.join(home, "providers", "codex"),
  ]) {
    yield* fs
      .makeDirectory(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
      .pipe(Effect.mapError(failed));
  }
  yield* writeFileAtomic(
    path.join(home, "userdata", "settings.json"),
    toJson(seededServerSettings(home, path.join)),
  ).pipe(Effect.mapError(failed));
  yield* writeFileAtomic(
    path.join(home, "providers", "claude", "settings.json"),
    toJson(SEEDED_CLAUDE_SETTINGS),
  ).pipe(Effect.mapError(failed));
  yield* writeProfileMirror(profilesRoot, entry);
});
