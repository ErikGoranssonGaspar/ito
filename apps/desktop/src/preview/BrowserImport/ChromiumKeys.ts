// @effect-diagnostics nodeBuiltinImport:off - `node:crypto` implements the
// OSCrypt key derivation Chromium uses; Effect has no equivalent.
/**
 * Chromium cookie-encryption keys. macOS keeps a key in the login keychain;
 * legacy Windows stores protect a random AES key with DPAPI.
 *
 * @module ChromiumKeys
 */
import * as NodeCrypto from "node:crypto";

import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";

import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const KEY_SALT = "saltysalt";
const KEY_LENGTH = 16;
const MAC_KEY_ITERATIONS = 1003;

export const ChromiumKeyFailure = Schema.Literals([
  "needsKeychainApproval",
  "keychainItemMissing",
  "keychainUnavailable",
  "unsupportedPlatform",
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
  /** AES-256-GCM key used by pre-App-Bound Chromium on Windows. */
  readonly gcmV10?: Buffer;
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
  // Only macOS cookie imports need this binding; loading it at startup can
  // prevent the desktop from opening on platforms that never use it.
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

const WindowsLocalState = Schema.Struct({
  os_crypt: Schema.Struct({
    encrypted_key: Schema.String,
    app_bound_encrypted_key: Schema.optional(Schema.String),
  }),
});
const decodeWindowsLocalState = Schema.decodeUnknownEffect(
  Schema.fromJsonString(WindowsLocalState),
);
const DPAPI_PREFIX = Buffer.from("DPAPI");
const WINDOWS_KEY_LENGTH = 32;
const WINDOWS_DPAPI_SCRIPT =
  "Add-Type -AssemblyName System.Security;" +
  "$value=[Console]::In.ReadToEnd();" +
  "$encrypted=[Convert]::FromBase64String($value);" +
  "$plain=[Security.Cryptography.ProtectedData]::Unprotect($encrypted,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);" +
  "[Console]::Out.Write([Convert]::ToBase64String($plain))";

export const decodeWindowsWrappedKey = Effect.fn("ChromiumKeys.decodeWindowsWrappedKey")(function* (
  contents: string,
) {
  const state = yield* decodeWindowsLocalState(contents).pipe(
    Effect.mapError((cause) => new ChromiumKeyError({ reason: "readFailed", cause })),
  );
  if (state.os_crypt.app_bound_encrypted_key !== undefined) {
    return yield* new ChromiumKeyError({ reason: "unsupportedPlatform" });
  }
  const wrapped = yield* Effect.fromResult(
    Encoding.decodeBase64(state.os_crypt.encrypted_key),
  ).pipe(Effect.mapError((cause) => new ChromiumKeyError({ reason: "readFailed", cause })));
  const wrappedBuffer = Buffer.from(wrapped);
  if (!wrappedBuffer.subarray(0, DPAPI_PREFIX.length).equals(DPAPI_PREFIX)) {
    return yield* new ChromiumKeyError({ reason: "readFailed" });
  }
  return wrappedBuffer.subarray(DPAPI_PREFIX.length);
});

/** Unwraps a key with the current Windows user's DPAPI identity. */
export const unwrapWindowsDpapiKey = Effect.fn("ChromiumKeys.unwrapWindowsDpapiKey")(function* (
  wrapped: Buffer,
) {
  const environment = yield* HostProcessEnvironment;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const windowsRoot = environment.SystemRoot ?? environment.WINDIR;
      const powershell = windowsRoot
        ? `${windowsRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
        : "powershell.exe";
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(
            powershell,
            [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-WindowStyle",
              "Hidden",
              "-Command",
              WINDOWS_DPAPI_SCRIPT,
            ],
            {
              env: environment,
              stdin: Stream.encodeText(Stream.make(wrapped.toString("base64"))),
            },
          ),
        )
        .pipe(
          Effect.mapError(
            (cause) => new ChromiumKeyError({ reason: "keychainUnavailable", cause }),
          ),
        );
      const [plainEncoded, , exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.runDrain),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.mapError((cause) => new ChromiumKeyError({ reason: "readFailed", cause })));
      if (Number(exitCode) !== 0) {
        return yield* new ChromiumKeyError({ reason: "readFailed" });
      }
      const plain = yield* Effect.fromResult(Encoding.decodeBase64(plainEncoded)).pipe(
        Effect.mapError((cause) => new ChromiumKeyError({ reason: "readFailed", cause })),
      );
      if (plain.length !== WINDOWS_KEY_LENGTH) {
        return yield* new ChromiumKeyError({ reason: "readFailed" });
      }
      return Buffer.from(plain);
    }),
  );
});

/** Reads and unwraps a legacy Windows Chromium key without exposing it in argv. */
export const readWindowsKey = Effect.fn("ChromiumKeys.readWindowsKey")(function* (
  localStatePath: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const contents = yield* fileSystem
    .readFileString(localStatePath)
    .pipe(Effect.mapError((cause) => new ChromiumKeyError({ reason: "readFailed", cause })));
  return yield* unwrapWindowsDpapiKey(yield* decodeWindowsWrappedKey(contents));
});

export interface ChromiumKeyRequest {
  readonly platform: NodeJS.Platform;
  readonly keychainService: string | undefined;
  readonly keychainAccount: string | undefined;
}

export const resolveChromiumKeys = Effect.fn("ChromiumKeys.resolveChromiumKeys")(function* (
  request: ChromiumKeyRequest,
): Effect.fn.Return<ChromiumKeyMaterial, ChromiumKeyError> {
  if (request.platform === "darwin") {
    if (!request.keychainService || !request.keychainAccount) {
      return yield* new ChromiumKeyError({ reason: "unsupportedPlatform" });
    }
    const secret = yield* readKeychainSecret(request.keychainService, request.keychainAccount);
    return { cbcV10: derive(secret, MAC_KEY_ITERATIONS) };
  }

  return yield* new ChromiumKeyError({ reason: "unsupportedPlatform" });
});
