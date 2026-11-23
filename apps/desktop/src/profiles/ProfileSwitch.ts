import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { msg } from "gt-i18n";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopLifecycle from "../app/DesktopLifecycle.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";
import * as ElectronDialog from "../electron/ElectronDialog.ts";
import { m } from "../i18n/messages.ts";
import { DesktopProfileSwitch } from "./ProfileContract.ts";

const { logWarning } = makeComponentLogger("desktop-profiles");

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const dialog = yield* ElectronDialog.ElectronDialog;
  const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
  const relaunchContext = yield* Effect.context<DesktopLifecycle.DesktopLifecycleRuntimeServices>();

  const switchToPicker = Effect.gen(function* () {
    const { response } = yield* dialog.showMessageBox({
      type: "question",
      message: m(msg("Switch profile?")),
      detail: m(
        msg("T3 Code restarts and opens the profile picker. Agents that are running stop."),
      ),
      buttons: [
        m(msg("Switch", { $context: "button, restarts into the profile picker" })),
        m(msg("Cancel")),
      ],
      defaultId: 0,
      cancelId: 1,
    });
    if (response !== 0) return false;
    yield* lifecycle
      .relaunch("profile-switch", { kind: "picker" })
      .pipe(Effect.provideContext(relaunchContext));
    return true;
  }).pipe(
    Effect.catch((error) =>
      logWarning("could not ask to switch profile", { error: error.message }).pipe(
        Effect.as(false),
      ),
    ),
    Effect.withSpan("DesktopProfiles.switchToPicker"),
  );

  return DesktopProfileSwitch.of({ active: environment.profile, switchToPicker });
});

export const layer = Layer.effect(DesktopProfileSwitch, make);
