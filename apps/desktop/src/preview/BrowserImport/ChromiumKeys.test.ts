import { describe, expect, it } from "@effect/vitest";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcessSpawner } from "effect/unstable/process";
import { beforeEach, vi } from "vite-plus/test";

import {
  decodeWindowsWrappedKey,
  resolveChromiumKeys,
  unwrapWindowsDpapiKey,
} from "./ChromiumKeys.ts";

const { getPassword } = vi.hoisted(() => ({ getPassword: vi.fn<() => string | null>() }));

vi.mock("@napi-rs/keyring", () => ({
  Entry: class {
    getPassword = getPassword;
  },
}));

beforeEach(() => {
  getPassword.mockReset();
});

type CapturedCommand = {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly options: {
    readonly stdin?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
  };
};

const helperLayer = (input: {
  readonly stdout?: string;
  readonly capture?: (command: CapturedCommand) => void;
}) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          unref: Effect.succeed(Effect.void),
          stdin: Sink.drain,
          stdout: Stream.encodeText(Stream.make(input.stdout ?? "")),
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
        }),
      ).pipe(Effect.tap(() => Effect.sync(() => input.capture?.(command as CapturedCommand)))),
    ),
  );

describe("macOS Chromium secrets", () => {
  const request = {
    platform: "darwin",
    keychainService: "Chrome Safe Storage",
    keychainAccount: "Chrome",
  } as const;
  const noProcesses = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die("must not spawn")),
  );

  it.effect("derives the cookie key from the keychain secret", () =>
    Effect.gen(function* () {
      getPassword.mockReturnValue("macos-secret");
      const keys = yield* resolveChromiumKeys(request);
      expect(keys.cbcV10?.toString("hex")).toBe("3df7306fb1eac353289565a2f6b64f74");
    }).pipe(Effect.provide(noProcesses)),
  );

  it.effect("reports a missing keychain entry", () =>
    Effect.gen(function* () {
      getPassword.mockReturnValue(null);
      const error = yield* resolveChromiumKeys(request).pipe(Effect.flip);
      expect(error.reason).toBe("keychainItemMissing");
    }).pipe(Effect.provide(noProcesses)),
  );

  it.effect("preserves a denied keychain approval", () =>
    Effect.gen(function* () {
      const denied = new Error("User denied access");
      getPassword.mockImplementation(() => {
        throw denied;
      });
      const error = yield* resolveChromiumKeys(request).pipe(Effect.flip);
      expect(error.reason).toBe("needsKeychainApproval");
      expect(error.cause).toBe(denied);
    }).pipe(Effect.provide(noProcesses)),
  );
});

describe("Windows Chromium secrets", () => {
  it.effect("accepts only DPAPI-wrapped non-app-bound keys", () =>
    Effect.gen(function* () {
      const wrapped = Buffer.from("wrapped-key");
      const encoded = Buffer.concat([Buffer.from("DPAPI"), wrapped]).toString("base64");
      const localState = `{"os_crypt":{"encrypted_key":"${encoded}"}}`;
      expect(yield* decodeWindowsWrappedKey(localState)).toEqual(wrapped);

      const appBound = yield* decodeWindowsWrappedKey(
        `{"os_crypt":{"encrypted_key":"${encoded}","app_bound_encrypted_key":"present"}}`,
      ).pipe(Effect.flip);
      expect(appBound.reason).toBe("unsupportedPlatform");

      const malformed = yield* decodeWindowsWrappedKey(
        `{"os_crypt":{"encrypted_key":"${wrapped.toString("base64")}"}}`,
      ).pipe(Effect.flip);
      expect(malformed.reason).toBe("readFailed");
    }),
  );

  it.effect("unwraps the binary key through PowerShell without placing it in argv", () => {
    let captured: CapturedCommand | undefined;
    const wrapped = Buffer.from("wrapped-key");
    const key = Buffer.from("0123456789abcdef0123456789abcdef");
    return Effect.gen(function* () {
      expect(yield* unwrapWindowsDpapiKey(wrapped)).toEqual(key);
      expect(captured?.command).toBe(
        "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      );
      expect(captured?.args).toContain("-NonInteractive");
      expect(captured?.args.join(" ")).not.toContain(wrapped.toString("base64"));
    }).pipe(
      Effect.provide(
        helperLayer({ stdout: key.toString("base64"), capture: (value) => (captured = value) }),
      ),
      Effect.provideService(HostProcessEnvironment, { SystemRoot: "C:\\Windows" }),
    );
  });
});
