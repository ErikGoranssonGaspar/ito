import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/Itô.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/Itô.app/Contents/Resources",
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const makeEnvironmentLayer = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest(env)),
    ),
  );

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(makeEnvironmentLayer(overrides, env)));

describe("DesktopEnvironment", () => {
  it.effect("derives state paths and development identity inside Effect", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          ITO_HOME: " /tmp/ito ",
          ITO_COMMIT_HASH: " 0123456789abcdef ",
          ITO_PORT: "4949",
          VITE_DEV_SERVER_URL: "http://localhost:5173",
          ITO_DEV_REMOTE_Ito_SERVER_ENTRY_PATH: " /remote/server.mjs ",
          ITO_OTLP_TRACES_URL: " http://127.0.0.1:4318/v1/traces ",
          ITO_OTLP_EXPORT_INTERVAL_MS: "2500",
          ITO_OTLP_HEADERS: "authorization=Basic%20abc%3D%3D,x-tenant=ito",
          ITO_OTLP_PROTOCOL: "http/protobuf",
        },
      );

      assert.equal(environment.isDevelopment, true);
      assert.equal(environment.appDataDirectory, "/Users/alice/Library/Application Support");
      assert.equal(environment.baseDir, "/tmp/ito");
      assert.equal(environment.stateDir, "/tmp/ito/userdata");
      assert.equal(environment.desktopSettingsPath, "/tmp/ito/userdata/desktop-settings.json");
      assert.equal(environment.clientSettingsPath, "/tmp/ito/userdata/client-settings.json");
      assert.equal(
        environment.savedEnvironmentRegistryPath,
        "/tmp/ito/userdata/saved-environments.json",
      );
      assert.equal(environment.serverSettingsPath, "/tmp/ito/userdata/settings.json");
      assert.equal(environment.logDir, "/tmp/ito/userdata/logs");
      assert.equal(environment.browserArtifactsDir, "/tmp/ito/userdata/browser-artifacts");
      assert.equal(environment.rootDir, "/repo");
      assert.equal(environment.appRoot, "/repo");
      assert.equal(environment.serverRoot, "/repo");
      assert.equal(environment.backendEntryPath, "/repo/apps/server/dist/bin.mjs");
      assert.equal(environment.backendCwd, "/repo");
      assert.deepEqual(
        Option.map(environment.devServerUrl, (url) => url.href),
        Option.some("http://localhost:5173/"),
      );
      assert.deepEqual(environment.devRemoteItoServerEntryPath, Option.some("/remote/server.mjs"));
      assert.deepEqual(environment.configuredBackendPort, Option.some(4949));
      assert.deepEqual(environment.commitHashOverride, Option.some("0123456789abcdef"));
      assert.deepEqual(environment.otlpTracesUrl, Option.some("http://127.0.0.1:4318/v1/traces"));
      assert.equal(environment.otlpExportIntervalMs, 2500);
      assert.deepEqual(
        environment.otlpHeaders,
        Option.some({
          authorization: "Basic abc==",
          "x-tenant": "ito",
        }),
      );
      assert.equal(environment.otlpProtocol, "http/protobuf");
    }),
  );

  it.effect("stores production state under userdata in an explicit home", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment(
        {},
        {
          ITO_HOME: "/tmp/ito",
        },
      );

      assert.equal(environment.isDevelopment, false);
      assert.equal(environment.stateDir, "/tmp/ito/userdata");
      assert.equal(environment.logDir, "/tmp/ito/userdata/logs");
      assert.equal(environment.browserArtifactsDir, "/tmp/ito/userdata/browser-artifacts");
      assert.equal(environment.serverSettingsPath, "/tmp/ito/userdata/settings.json");
      assert.equal(environment.otlpProtocol, "http/json");
    }),
  );

  it.effect("keeps implicit development state separate from production state", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment();

      assert.equal(development.stateDir, "/Users/alice/.ito/dev");
      assert.equal(production.stateDir, "/Users/alice/.ito/userdata");
    }),
  );

  it.effect("resolves picker defaults without nullish sentinels", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment();

      assert.deepEqual(environment.resolvePickFolderDefaultPath(null), Option.none());
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: " " }),
        Option.none(),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~" }),
        Option.some("/Users/alice"),
      );
      assert.deepEqual(
        environment.resolvePickFolderDefaultPath({ initialPath: "~/project" }),
        Option.some("/Users/alice/project"),
      );
    }),
  );
});
