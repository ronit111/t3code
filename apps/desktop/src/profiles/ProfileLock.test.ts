import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  hashPassword,
  PRODUCTION_SCRYPT_PARAMETERS,
  ProfileScryptParameters,
  verifyPassword,
} from "./ProfileLock.ts";

const fast = Effect.provideService(ProfileScryptParameters, {
  ...PRODUCTION_SCRYPT_PARAMETERS,
  N: 1024,
});

describe("ProfileLock", () => {
  it("keeps the production scrypt parameters", () => {
    assert.deepEqual(PRODUCTION_SCRYPT_PARAMETERS, {
      N: 131072,
      r: 8,
      p: 1,
      keyLength: 64,
      maxmem: 256 * 1024 * 1024,
    });
  });

  it.effect("verifies the right password and rejects a wrong one", () =>
    Effect.gen(function* () {
      const lock = yield* hashPassword("correct horse");
      assert.include(lock, { kdf: "scrypt", N: 1024, r: 8, p: 1, keyLength: 64 });
      assert.equal(Buffer.from(lock.salt, "base64").length, 16);
      assert.isTrue(yield* verifyPassword("correct horse", lock));
      assert.isFalse(yield* verifyPassword("correct horsf", lock));
    }).pipe(fast),
  );

  it.effect("salts each hash", () =>
    Effect.gen(function* () {
      const first = yield* hashPassword("same");
      const second = yield* hashPassword("same");
      assert.notEqual(first.salt, second.salt);
      assert.notEqual(first.hash, second.hash);
    }).pipe(fast),
  );

  it.effect("rejects a tampered or truncated hash without throwing", () =>
    Effect.gen(function* () {
      const lock = yield* hashPassword("secret");
      const bytes = Buffer.from(lock.hash, "base64");
      bytes[0] = (bytes[0] ?? 0) ^ 0xff;
      assert.isFalse(yield* verifyPassword("secret", { ...lock, hash: bytes.toString("base64") }));
      assert.isFalse(
        yield* verifyPassword("secret", {
          ...lock,
          hash: bytes.subarray(0, 32).toString("base64"),
        }),
      );
      assert.isFalse(yield* verifyPassword("secret", { ...lock, N: 3 }));
    }).pipe(fast),
  );
});
