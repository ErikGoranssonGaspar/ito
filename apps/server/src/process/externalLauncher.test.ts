import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as ExternalLauncher from "./externalLauncher.ts";

function makeMockDetachedHandle(onUnref?: () => void) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    isRunning: Effect.succeed(true),
    kill: () => Effect.void,
    unref: Effect.sync(() => {
      onUnref?.();
      return Effect.void;
    }),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

const testLayer = (input: {
  readonly env?: Record<string, string>;
  readonly onSpawn?: (command: ChildProcess.StandardCommand) => void;
  readonly onUnref?: () => void;
}) => {
  const spawnerLayer = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        assert.equal(ChildProcess.isStandardCommand(command), true);
        if (!ChildProcess.isStandardCommand(command)) {
          throw new Error("Expected a standard command");
        }
        input.onSpawn?.(command);
        return makeMockDetachedHandle(input.onUnref);
      }),
    ),
  );

  return Layer.mergeAll(
    ExternalLauncher.layer.pipe(Layer.provide(Layer.merge(NodeServices.layer, spawnerLayer))),
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: input.env ?? {} })),
  );
};

it.effect("launches the default browser with macOS open", () => {
  let spawned: ChildProcess.StandardCommand | undefined;
  let didUnref = false;
  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;

    yield* launcher.launchBrowser("https://example.com/some path");

    assert.ok(spawned);
    assert.equal(spawned.command, "open");
    assert.deepEqual(spawned.args, ["https://example.com/some path"]);
    assert.equal(spawned.options.detached, true);
    assert.equal(didUnref, true);
  }).pipe(
    Effect.provide(
      testLayer({
        onSpawn: (command) => {
          spawned = command;
        },
        onUnref: () => {
          didUnref = true;
        },
      }),
    ),
  );
});

it.effect("launches Cursor in classic IDE mode", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "ito-editors-" });
    const cursorPath = path.join(binDir, "cursor");
    yield* fileSystem.writeFileString(cursorPath, "#!/bin/sh\n");
    yield* fileSystem.chmod(cursorPath, 0o755);

    const spawned: ChildProcess.StandardCommand[] = [];
    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      for (const cwd of [
        "/workspace with spaces",
        "/workspace with spaces/src/index.ts",
        "/workspace with spaces/src/index.ts:12",
        "/workspace with spaces/src/index.ts:12:4",
      ]) {
        yield* launcher.launchEditor({ editor: "cursor", cwd });
      }
    }).pipe(
      Effect.provide(
        testLayer({
          env: { PATH: binDir },
          onSpawn: (command) => spawned.push(command),
        }),
      ),
    );

    assert.deepEqual(
      spawned.map((command) => ({ command: command.command, args: command.args })),
      [
        { command: "cursor", args: ["--classic", "/workspace with spaces"] },
        { command: "cursor", args: ["--classic", "/workspace with spaces/src/index.ts"] },
        {
          command: "cursor",
          args: ["--classic", "--goto", "/workspace with spaces/src/index.ts:12"],
        },
        {
          command: "cursor",
          args: ["--classic", "--goto", "/workspace with spaces/src/index.ts:12:4"],
        },
      ],
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
it.effect("reveals a file in Finder with open -R on macOS", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "ito-editors-" });
    const openPath = path.join(binDir, "open");
    yield* fileSystem.writeFileString(openPath, "#!/bin/sh\n");
    yield* fileSystem.chmod(openPath, 0o755);

    let spawned: ChildProcess.StandardCommand | undefined;
    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      yield* launcher.launchEditor({
        editor: "file-manager",
        cwd: "/workspace/media/clip.mp4",
        reveal: true,
      });
    }).pipe(
      Effect.provide(
        testLayer({
          env: { PATH: binDir },
          onSpawn: (command) => {
            spawned = command;
          },
        }),
      ),
    );

    assert.ok(spawned);
    assert.equal(spawned.command, "open");
    assert.deepEqual(spawned.args, ["-R", "/workspace/media/clip.mp4"]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("discovers installed editors and Finder", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "ito-editors-" });
    for (const command of ["code", "open"]) {
      const executable = path.join(binDir, command);
      yield* fileSystem.writeFileString(executable, "#!/bin/sh\n");
      yield* fileSystem.chmod(executable, 0o755);
    }

    const result = yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      return {
        editors: yield* launcher.resolveAvailableEditors(),
        revealKind: yield* launcher.resolveFileManagerRevealKind(),
      };
    }).pipe(Effect.provide(testLayer({ env: { PATH: binDir } })));

    assert.include(result.editors, "vscode");
    assert.include(result.editors, "file-manager");
    assert.equal(result.revealKind, "finder");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("memoizes editor discovery and refreshes after the cache window", () => {
  let statCalls = 0;
  const fileInfo = { type: "File" } as FileSystem.File.Info;
  const launcherLayer = ExternalLauncher.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        FileSystem.layerNoop({
          stat: () =>
            Effect.sync(() => {
              statCalls += 1;
              return fileInfo;
            }),
        }),
        Path.layer,
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.sync(() => makeMockDetachedHandle())),
        ),
      ),
    ),
  );

  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;

    const first = yield* launcher.resolveAvailableEditors();
    const statCallsAfterFirstScan = statCalls;
    assert.isAbove(statCallsAfterFirstScan, 0);

    // Past the shared command-resolution cache TTL (30s) but within the
    // discovery cache window: the memoized set is reused without any scan.
    yield* TestClock.adjust("31 seconds");
    const second = yield* launcher.resolveAvailableEditors();
    assert.deepEqual([...second], [...first]);
    assert.equal(statCalls, statCallsAfterFirstScan);

    // Past the discovery cache window the next call rescans.
    yield* TestClock.adjust("30 seconds");
    yield* launcher.resolveAvailableEditors();
    assert.isAbove(statCalls, statCallsAfterFirstScan);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        launcherLayer,
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: {
              PATH: "/tmp/ito-editor-discovery-cache-test",
            },
          }),
        ),
        TestClock.layer(),
      ),
    ),
  );
});

// A client that disconnects mid-scan interrupts the shared discovery effect on
// the connection fiber. The cache must not retain that interrupt: doing so
// replayed it to every later connect for the whole TTL, so `server.getConfig`
// failed and no client could reconnect until the server restarted.
it.effect("rescans after an interrupted discovery instead of caching the interrupt", () => {
  const fileInfo = { type: "File" } as FileSystem.File.Info;
  let blockFirstScan = true;
  let scans = 0;
  const launcherLayer = ExternalLauncher.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        FileSystem.layerNoop({
          // The first scan parks inside `stat` so the interrupt lands while
          // discovery is in flight, which is what a client disconnecting
          // mid-connect does to the shared effect.
          stat: () =>
            Effect.gen(function* () {
              scans += 1;
              if (blockFirstScan) {
                return yield* Effect.never;
              }
              return fileInfo;
            }),
        }),
        Path.layer,
        Layer.succeed(
          ChildProcessSpawner.ChildProcessSpawner,
          ChildProcessSpawner.make(() => Effect.sync(() => makeMockDetachedHandle())),
        ),
      ),
    ),
  );

  return Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;

    const fiber = yield* Effect.forkChild(launcher.resolveAvailableEditors());
    yield* Effect.yieldNow;
    yield* Fiber.interrupt(fiber);

    // The next connect must still get a real answer well inside the TTL.
    blockFirstScan = false;
    scans = 0;
    yield* launcher.resolveAvailableEditors();
    assert.isAbove(scans, 0);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        launcherLayer,
        ConfigProvider.layer(
          ConfigProvider.fromEnv({
            env: {
              PATH: "/tmp/ito-editor-discovery-interrupt-test",
            },
          }),
        ),
      ),
    ),
  );
});

it.effect("rejects unknown editors through the service API", () =>
  Effect.gen(function* () {
    const launcher = yield* ExternalLauncher.ExternalLauncher;
    const error = yield* launcher
      .launchEditor({ editor: "missing-editor" as never, cwd: "/tmp/workspace" })
      .pipe(Effect.flip);
    assert.instanceOf(error, ExternalLauncher.ExternalLauncherUnknownEditorError);
    assert.equal(error.editor, "missing-editor");
    assert.equal(error.message, "Unknown editor: missing-editor");
  }).pipe(Effect.provide(testLayer({ env: { PATH: "" } }))),
);
