// Registry for the desktop's backend process.
//
// `DesktopBackendManager.ts` exposes a per-instance factory
// (`makeBackendInstance(spec)`); the pool calls it once for the local
// backend and exposes it as `pool.primary`. The primary spec wires
// `configResolve` to `DesktopBackendConfiguration.resolvePrimary` and the
// `onReady` / `onShutdown` callbacks to the window service.
//
// `getLocalEnvironmentBootstraps()` returns one entry per registered
// instance with bootstrap info; the primary keeps the "primary" id.

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as FileSystem from "effect/FileSystem";
import { HttpClient } from "effect/unstable/http";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as DesktopBackendConfiguration from "./DesktopBackendConfiguration.ts";
import * as DesktopBackendManager from "./DesktopBackendManager.ts";
import * as DesktopObservability from "../app/DesktopObservability.ts";
import * as DesktopTelemetryPublisher from "../telemetry/DesktopTelemetryPublisher.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

const { logWarning: logBackendPoolWarning } =
  DesktopObservability.makeComponentLogger("desktop-backend-pool");

export type BackendInstanceId = DesktopBackendManager.BackendInstanceId;
export const BackendInstanceId = DesktopBackendManager.BackendInstanceId;
export const PRIMARY_INSTANCE_ID = DesktopBackendManager.PRIMARY_INSTANCE_ID;
export type DesktopBackendInstance = DesktopBackendManager.DesktopBackendInstance;
export type BackendInstanceSpec = DesktopBackendManager.BackendInstanceSpec;

export class DesktopBackendPool extends Context.Service<
  DesktopBackendPool,
  {
    // Look up a registered instance. None when no backend with that id is
    // currently registered.
    readonly get: (id: BackendInstanceId) => Effect.Effect<Option.Option<DesktopBackendInstance>>;
    // Snapshot of all currently-registered instances.
    readonly list: Effect.Effect<readonly DesktopBackendInstance[]>;
    // Convenience accessor for the always-registered primary instance,
    // exposed as a typed effect so consumers don't have to handle the
    // Option for the case that's guaranteed to be present.
    readonly primary: Effect.Effect<DesktopBackendInstance>;
  }
>()("@ito/desktop/backend/DesktopBackendPool") {}

// Services required by makeBackendInstance — exported so callers that
// build their own specs can confirm the layer graph satisfies them at
// compile time.
export type BackendInstanceFactoryRequirements =
  | FileSystem.FileSystem
  | ChildProcessSpawner.ChildProcessSpawner
  | HttpClient.HttpClient
  | DesktopObservability.DesktopBackendOutputLogFactory
  | DesktopTelemetryPublisher.DesktopTelemetryPublisher;

export const layer = Layer.effect(
  DesktopBackendPool,
  Effect.gen(function* () {
    const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;
    const desktopWindow = yield* DesktopWindow.DesktopWindow;

    const primary = yield* DesktopBackendManager.makeBackendInstance({
      id: DesktopBackendManager.PRIMARY_INSTANCE_ID,
      label: configuration.resolvePrimaryLabel,
      configResolve: configuration.resolvePrimary,
      // Window creation errors propagating out of handleBackendReady must
      // not block the readiness callback (that would prevent restartAttempt
      // from being reset), so we absorb them here. The window service only
      // logs on success, so log the failure here before swallowing it —
      // otherwise a post-readiness window-open failure vanishes silently and
      // is near-impossible to diagnose in production.
      onReady: (httpBaseUrl) =>
        desktopWindow.handleBackendReady(httpBaseUrl).pipe(
          Effect.catch((error) =>
            logBackendPoolWarning("failed to open main window after backend readiness", {
              error: error.message,
            }),
          ),
        ),
      onShutdown: () => desktopWindow.handleBackendNotReady,
    });

    return DesktopBackendPool.of({
      get: (id) =>
        Effect.succeed(
          id === DesktopBackendManager.PRIMARY_INSTANCE_ID ? Option.some(primary) : Option.none(),
        ),
      list: Effect.succeed([primary]),
      primary: Effect.succeed(primary),
    });
  }),
);

// Test layer for unit tests that want to assert against a known pool
// composition without standing up the full manager. The first instance is
// surfaced as `primary`.
export const layerTest = (
  instances: readonly DesktopBackendInstance[],
): Layer.Layer<DesktopBackendPool> =>
  Layer.effect(
    DesktopBackendPool,
    Effect.gen(function* () {
      if (instances.length === 0) {
        return yield* Effect.die("DesktopBackendPool.layerTest requires at least one instance");
      }
      const byId = new Map<BackendInstanceId, DesktopBackendInstance>(
        instances.map((instance) => [instance.id, instance] as const),
      );
      const primary = instances[0]!;
      return DesktopBackendPool.of({
        get: (id) => Effect.succeed(Option.fromNullishOr(byId.get(id))),
        list: Effect.succeed(Array.from(byId.values())),
        primary: Effect.succeed(primary),
      });
    }),
  );
