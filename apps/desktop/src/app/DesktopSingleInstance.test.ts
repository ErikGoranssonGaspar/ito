import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { beforeEach, vi } from "vite-plus/test";

const { requestLock, releaseLock } = vi.hoisted(() => ({
  requestLock: vi.fn(),
  releaseLock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    requestSingleInstanceLock: requestLock,
    releaseSingleInstanceLock: releaseLock,
  },
}));

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopSingleInstance from "./DesktopSingleInstance.ts";

const makeLayer = (events: string[]) => {
  const environment = DesktopEnvironment.DesktopEnvironment.of({
    appDataDirectory: "/tmp/app-data",
    userDataDirName: "ito-dev",
    legacyUserDataDirName: "Itô",
    path: { join: (...parts: ReadonlyArray<string>) => parts.join("/") },
  } as unknown as DesktopEnvironment.DesktopEnvironment["Service"]);
  const electronApp = {
    setPath: (name: string, value: string) =>
      Effect.sync(() => events.push(`setPath:${name}:${value}`)),
    quit: Effect.sync(() => events.push("quit")),
    on: (name: string) => Effect.sync(() => events.push(`on:${name}`)),
  } as unknown as ElectronApp.ElectronApp["Service"];
  return {
    electronApp,
    layer: DesktopSingleInstance.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment),
          Layer.succeed(ElectronApp.ElectronApp, electronApp),
          FileSystem.layerNoop({ exists: () => Effect.succeed(false) }),
        ),
      ),
    ),
  };
};

describe("DesktopSingleInstance", () => {
  beforeEach(() => {
    requestLock.mockReset().mockReturnValue(true);
    releaseLock.mockReset();
  });

  it.effect("sets the existing user-data path before locking and releases on shutdown", () => {
    const events: string[] = [];
    requestLock.mockImplementation(() => {
      events.push("lock");
      return true;
    });
    releaseLock.mockImplementation(() => events.push("release"));

    return Effect.gen(function* () {
      yield* Effect.scoped(Layer.build(makeLayer(events).layer));
      assert.deepEqual(events, ["setPath:userData:/tmp/app-data/ito-dev", "lock", "release"]);
    });
  });

  it.effect("quits before opening another instance", () => {
    requestLock.mockReturnValue(false);
    const events: string[] = [];

    return Effect.gen(function* () {
      const exit = yield* Effect.exit(Effect.scoped(Layer.build(makeLayer(events).layer)));
      assert.isTrue(Exit.hasInterrupts(exit));
      assert.deepEqual(events, ["setPath:userData:/tmp/app-data/ito-dev", "quit"]);
      assert.lengthOf(releaseLock.mock.calls, 0);
    });
  });

  it.effect("registers the handler that reveals the existing window", () => {
    const events: string[] = [];
    const { electronApp, layer } = makeLayer(events);
    const windows = {} as ElectronWindow.ElectronWindow["Service"];

    return Effect.gen(function* () {
      const singleInstance = yield* DesktopSingleInstance.DesktopSingleInstance;
      yield* singleInstance.configure;
      assert.deepEqual(events.slice(0, 2), [
        "setPath:userData:/tmp/app-data/ito-dev",
        "on:second-instance",
      ]);
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(ElectronApp.ElectronApp, electronApp),
      Effect.provideService(ElectronWindow.ElectronWindow, windows),
    );
  });
});
