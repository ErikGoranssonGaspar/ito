import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";
import * as DesktopStateMigration from "./DesktopStateMigration.ts";

export class DesktopSingleInstance extends Context.Service<
  DesktopSingleInstance,
  {
    readonly configure: Effect.Effect<
      void,
      never,
      ElectronApp.ElectronApp | ElectronWindow.ElectronWindow | Scope.Scope
    >;
  }
>()("@ito/desktop/app/DesktopSingleInstance") {}

/** Set the existing user-data path before Electron takes its single-instance lock. */
export const make = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  // Before the lock, so no other process has the SQLite database open. A failed
  // copy must not stop the app: it just starts on empty state, and the T3 Code
  // directories are still there to retry from.
  yield* DesktopStateMigration.migrateLegacyState.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not carry legacy T3 Code state over to Itô").pipe(
        Effect.annotateLogs({ cause }),
      ),
    ),
  );
  const userDataPath = yield* DesktopAppIdentity.resolveUserDataPath;
  yield* electronApp.setPath("userData", userDataPath);

  const primary = yield* Effect.sync(() => Electron.app.requestSingleInstanceLock());
  if (!primary) {
    yield* electronApp.quit;
    return yield* Effect.interrupt;
  }
  yield* Effect.addFinalizer(() => Effect.sync(() => Electron.app.releaseSingleInstanceLock()));

  return DesktopSingleInstance.of({
    configure: Effect.gen(function* () {
      const app = yield* ElectronApp.ElectronApp;
      const windows = yield* ElectronWindow.ElectronWindow;
      const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
      const runPromise = Effect.runPromiseWith(context);

      yield* app.on("second-instance", () => {
        void runPromise(
          Effect.gen(function* () {
            const mainWindow = yield* windows.currentMainOrFirst;
            if (Option.isSome(mainWindow)) {
              yield* windows.reveal(mainWindow.value);
            }
          }),
        );
      });
    }).pipe(Effect.withSpan("desktop.singleInstance.configure")),
  });
});

export const layer = Layer.effect(DesktopSingleInstance, make);
