// @effect-diagnostics nodeBuiltinImport:off - Effect has no scrypt or constant-time compare.
import * as NodeCrypto from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { ProfileLockRecord } from "./ProfileRegistry.ts";

export interface ScryptParameters {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly keyLength: number;
  readonly maxmem: number;
}

export const PRODUCTION_SCRYPT_PARAMETERS: ScryptParameters = {
  N: 131072,
  r: 8,
  p: 1,
  keyLength: 64,
  maxmem: 256 * 1024 * 1024,
};

const SALT_BYTES = 16;

/** Tests lower the cost here; production never provides it. */
export const ProfileScryptParameters = Context.Reference<ScryptParameters>(
  "@t3tools/desktop/profiles/ProfileScryptParameters",
  { defaultValue: () => PRODUCTION_SCRYPT_PARAMETERS },
);

class ProfileScryptError extends Schema.TaggedError<ProfileScryptError>()("ProfileScryptError", {
  cause: Schema.Defect(),
}) {}

const scrypt = (password: string, salt: Buffer, parameters: ScryptParameters) =>
  Effect.callback<Buffer, ProfileScryptError>((resume) => {
    try {
      NodeCrypto.scrypt(
        password.normalize("NFC"),
        salt,
        parameters.keyLength,
        { N: parameters.N, r: parameters.r, p: parameters.p, maxmem: parameters.maxmem },
        (error, key) =>
          resume(
            error === null
              ? Effect.succeed(key)
              : Effect.fail(new ProfileScryptError({ cause: error })),
          ),
      );
    } catch (error) {
      // Node throws synchronously for parameters it rejects, such as an N that is not a power of 2.
      resume(Effect.fail(new ProfileScryptError({ cause: error })));
    }
  });

export const hashPassword = Effect.fn("DesktopProfiles.hashPassword")(function* (password: string) {
  const parameters = yield* ProfileScryptParameters;
  const salt = NodeCrypto.randomBytes(SALT_BYTES);
  const hash = yield* scrypt(password, salt, parameters).pipe(Effect.orDie);
  return {
    kdf: "scrypt",
    N: parameters.N,
    r: parameters.r,
    p: parameters.p,
    keyLength: parameters.keyLength,
    salt: salt.toString("base64"),
    hash: hash.toString("base64"),
  } satisfies ProfileLockRecord;
});

/** False for a wrong password or a damaged record; never fails. */
export const verifyPassword = Effect.fn("DesktopProfiles.verifyPassword")(function* (
  password: string,
  lock: ProfileLockRecord,
) {
  const expected = Buffer.from(lock.hash, "base64");
  if (expected.length !== lock.keyLength) return false;
  const actual = yield* scrypt(password, Buffer.from(lock.salt, "base64"), {
    N: lock.N,
    r: lock.r,
    p: lock.p,
    keyLength: lock.keyLength,
    // A record asking for more memory than production uses fails here instead of exhausting RAM.
    maxmem: PRODUCTION_SCRYPT_PARAMETERS.maxmem,
  }).pipe(Effect.option);
  if (actual._tag === "None" || actual.value.length !== expected.length) return false;
  return NodeCrypto.timingSafeEqual(actual.value, expected);
});
