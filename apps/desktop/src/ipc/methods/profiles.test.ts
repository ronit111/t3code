import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import {
  type ActiveProfile,
  DesktopProfileSwitch,
  type ProfileId,
} from "../../profiles/ProfileContract.ts";
import { getActiveProfile, getProfilesEnabled, switchProfile } from "./profiles.ts";

const active: ActiveProfile = {
  id: "p7k2m9x4q1" as ProfileId,
  name: "Work",
  isDefault: false,
  profilesRoot: "/Users/u/.t3-profiles",
  registryExists: true,
};

const layerSwitch = (calls: Ref.Ref<number>, confirmed: boolean, profile = active) =>
  Layer.succeed(DesktopProfileSwitch, {
    active: profile,
    switchToPicker: Ref.update(calls, (n) => n + 1).pipe(Effect.as(confirmed)),
  });

describe("profiles IPC", () => {
  it.effect("switchProfile runs switchToPicker once and returns its answer", () =>
    Effect.gen(function* () {
      for (const confirmed of [true, false]) {
        const calls = yield* Ref.make(0);
        const result = yield* switchProfile
          .handler(undefined)
          .pipe(Effect.provide(layerSwitch(calls, confirmed)));
        assert.strictEqual(result, confirmed);
        assert.strictEqual(yield* Ref.get(calls), 1);
      }
    }),
  );

  it.effect("getActive returns the active profile without switching", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      const result = yield* getActiveProfile
        .handler(undefined)
        .pipe(Effect.provide(layerSwitch(calls, true)));
      assert.deepStrictEqual(result, { id: "p7k2m9x4q1", name: "Work", isDefault: false });
      assert.strictEqual(yield* Ref.get(calls), 0);
    }),
  );

  it.effect("profiles are enabled only with a profiles root", () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      assert.isTrue(
        yield* getProfilesEnabled.handler().pipe(Effect.provide(layerSwitch(calls, true))),
      );
      assert.isFalse(
        yield* getProfilesEnabled
          .handler()
          .pipe(Effect.provide(layerSwitch(calls, true, { ...active, profilesRoot: null }))),
      );
    }),
  );
});
