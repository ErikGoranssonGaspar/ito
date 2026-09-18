// @effect-diagnostics nodeBuiltinImport:off - `node:crypto` implements the
// OSCrypt key derivation Chromium uses; Effect has no equivalent.
/**
 * Chromium cookie-encryption keys, which macOS keeps in the login keychain.
 *
 * @module ChromiumKeys
 */
import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const KEY_SALT = "saltysalt";
const KEY_LENGTH = 16;
const MAC_KEY_ITERATIONS = 1003;

export const ChromiumKeyFailure = Schema.Literals([
  "needsKeychainApproval",
  "keychainItemMissing",
  "keychainUnavailable",
  /** The source names no keychain item, so there is no key to derive. */
  "unsupportedSource",
  /** The key store itself could not be read, as opposed to holding no key. */
  "readFailed",
]);
export type ChromiumKeyFailure = typeof ChromiumKeyFailure.Type;

export class ChromiumKeyError extends Schema.TaggedError<ChromiumKeyError>()("ChromiumKeyError", {
  reason: ChromiumKeyFailure,
  /** Kept for the log; never surfaced to the user. */
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Could not obtain the Chromium cookie key: ${this.reason}.`;
  }
}

/**
 * Keys to try, indexed by the record prefix they decrypt. A database can hold
 * records written under more than one scheme, so a missing entry means those
 * records are skipped rather than the whole import failing.
 */
export interface ChromiumKeyMaterial {
  /** AES-128-CBC on macOS. */
  readonly cbcV10?: Buffer;
}

const derive = (passphrase: string, iterations: number) =>
  NodeCrypto.pbkdf2Sync(passphrase, KEY_SALT, iterations, KEY_LENGTH, "sha1");

/**
 * Reads the macOS OSCrypt secret from the login keychain.
 *
 * Uses the in-process Keychain API rather than shelling out to
 * `/usr/bin/security`, because macOS attributes both the consent prompt and the
 * resulting ACL entry to the binary that asks. Via the CLI the prompt says
 * "security" and "Always Allow" grants trust to a tool every process on the
 * machine can invoke; in-process it names this app and the grant belongs to it.
 * (In an unsigned dev build the name is the dev binary, not the shipped app
 * identity.)
 *
 * Deliberately untimed: macOS answers this with a modal, and a timeout racing
 * the user means the prompt can be approved while nothing is left listening,
 * which reads as "approving did nothing".
 */
const readKeychainSecret = Effect.fn("ChromiumKeys.readKeychainSecret")(function* (
  service: string,
  account: string,
) {
  // Imported lazily: loading the native binding at startup can prevent the
  // desktop from opening when it fails to load.
  const Keyring = yield* Effect.tryPromise({
    try: () => import("@napi-rs/keyring"),
    catch: (cause) => new ChromiumKeyError({ reason: "keychainUnavailable", cause }),
  });
  const secret = yield* Effect.try({
    try: () => new Keyring.Entry(service, account).getPassword(),
    catch: (cause) => {
      const message = String((cause as { message?: unknown } | undefined)?.message ?? "");
      // Distinguish the causes rather than reporting "approve the prompt" for
      // a failure approving cannot fix.
      const missing = /no (matching )?entry|not found/i.test(message);
      return new ChromiumKeyError({
        reason: missing ? "keychainItemMissing" : "needsKeychainApproval",
        cause,
      });
    },
  });
  if (secret === null || secret === "") {
    return yield* new ChromiumKeyError({ reason: "keychainItemMissing" });
  }
  return secret;
});

export interface ChromiumKeyRequest {
  readonly keychainService: string | undefined;
  readonly keychainAccount: string | undefined;
}

export const resolveChromiumKeys = Effect.fn("ChromiumKeys.resolveChromiumKeys")(function* (
  request: ChromiumKeyRequest,
): Effect.fn.Return<ChromiumKeyMaterial, ChromiumKeyError> {
  if (!request.keychainService || !request.keychainAccount) {
    return yield* new ChromiumKeyError({ reason: "unsupportedSource" });
  }
  const secret = yield* readKeychainSecret(request.keychainService, request.keychainAccount);
  return { cbcV10: derive(secret, MAC_KEY_ITERATIONS) };
});
