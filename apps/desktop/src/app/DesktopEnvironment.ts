import type { DesktopAppBranding, DesktopAppStageLabel } from "@ito/contracts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import {
  isConfiguredBaseDir,
  resolveDesktopBaseDir,
  resolveDesktopStateDir,
} from "./DesktopStatePaths.ts";
import type { OtlpProtocol } from "@ito/shared/observability";

export interface MakeDesktopEnvironmentInput {
  readonly dirname: string;
  readonly homeDirectory: string;
  readonly platform: NodeJS.Platform;
  readonly processArch: string;
  readonly appVersion: string;
  readonly appPath: string;
  readonly isPackaged: boolean;
  readonly resourcesPath: string;
}

export class DesktopEnvironment extends Context.Service<
  DesktopEnvironment,
  {
    readonly path: Path.Path;
    readonly dirname: string;
    readonly platform: NodeJS.Platform;
    readonly processArch: string;
    readonly isPackaged: boolean;
    readonly isDevelopment: boolean;
    readonly appVersion: string;
    readonly appPath: string;
    readonly resourcesPath: string;
    readonly homeDirectory: string;
    readonly appDataDirectory: string;
    readonly baseDir: string;
    readonly isBaseDirConfigured: boolean;
    readonly stateDir: string;
    readonly desktopSettingsPath: string;
    readonly clientSettingsPath: string;
    readonly savedEnvironmentRegistryPath: string;
    readonly serverSettingsPath: string;
    readonly logDir: string;
    readonly browserArtifactsDir: string;
    readonly rootDir: string;
    readonly appRoot: string;
    // Root of the tree containing apps/server/dist and node_modules for the
    // backend. Equals appRoot everywhere except packaged Windows, where the
    // server tree ships as the resources/server.asar sidecar (see
    // scripts/build-desktop-artifact.ts) that the asar-aware
    // ELECTRON_RUN_AS_NODE primary reads in place and the WSL backend
    // extracts on demand (see DesktopWslServerTree).
    readonly serverRoot: string;
    readonly backendEntryPath: string;
    // Built web client the packaged renderer is served from over ito://app.
    readonly clientAssetsDir: string;
    readonly backendCwd: string;
    readonly preloadPath: string;
    readonly devServerUrl: Option.Option<URL>;
    readonly devRemoteItoServerEntryPath: Option.Option<string>;
    readonly configuredBackendPort: Option.Option<number>;
    readonly commitHashOverride: Option.Option<string>;
    readonly otlpTracesUrl: Option.Option<string>;
    readonly otlpExportIntervalMs: number;
    readonly otlpHeaders: Option.Option<Record<string, string>>;
    readonly otlpProtocol: OtlpProtocol;
    readonly branding: DesktopAppBranding;
    readonly displayName: string;
    readonly userDataDirName: string;
    readonly legacyUserDataDirNames: ReadonlyArray<string>;
    readonly defaultDesktopSettings: DesktopAppSettings.DesktopSettings;
    readonly resolvePickFolderDefaultPath: (rawOptions: unknown) => Option.Option<string>;
    readonly resolveResourcePathCandidates: (fileName: string) => readonly string[];
  }
>()("@ito/desktop/app/DesktopEnvironment") {}

const APP_BASE_NAME = "Itô";

function resolveDesktopAppStageLabel(input: {
  readonly isDevelopment: boolean;
  readonly appVersion: string;
}): DesktopAppStageLabel {
  if (input.isDevelopment) {
    return "Dev";
  }

  return "Alpha";
}

export function resolveDesktopAppBranding(input: {
  readonly isDevelopment: boolean;
  readonly appVersion: string;
}): DesktopAppBranding {
  return {
    baseName: APP_BASE_NAME,
    // Kept as a build marker for the sidebar backdrop; the app names itself Itô
    // in the title bar, the About panel and every string that mentions it.
    stageLabel: resolveDesktopAppStageLabel(input),
    displayName: APP_BASE_NAME,
  };
}

const make = Effect.fn("desktop.environment.make")(function* (
  input: MakeDesktopEnvironmentInput,
): Effect.fn.Return<DesktopEnvironment["Service"], Config.ConfigError, Path.Path> {
  const path = yield* Path.Path;
  const config = yield* DesktopConfig.DesktopConfig;
  const homeDirectory = input.homeDirectory;
  const devServerUrl = config.devServerUrl;
  const isDevelopment = Option.isSome(devServerUrl);
  const appDataDirectory = path.join(homeDirectory, "Library", "Application Support");
  const baseDir = resolveDesktopBaseDir({
    homeDirectory,
    joinPath: path.join,
    itoHome: config.itoHome,
  });
  const rootDir = path.resolve(input.dirname, "../../..");
  const appRoot = input.isPackaged ? input.appPath : rootDir;
  const serverRoot = appRoot;
  const branding = resolveDesktopAppBranding({
    isDevelopment,
    appVersion: input.appVersion,
  });
  const displayName = branding.displayName;
  const stateDir = resolveDesktopStateDir({
    baseDir,
    isDevelopment,
    joinPath: path.join,
    itoHome: config.itoHome,
  });
  const userDataDirName = isDevelopment ? "ito-dev" : "ito";
  // Same precedence the fork used when it chose between these two: the
  // bundle-named directory wins, so a packaged install's data is preferred over
  // anything an unpackaged run left behind.
  const legacyUserDataDirNames = isDevelopment
    ? (["T3 Code (Dev)", "t3code-dev"] as const)
    : (["T3 Code (Alpha)", "t3code"] as const);
  const resourcesPath = input.resourcesPath;

  return DesktopEnvironment.of({
    path,
    dirname: input.dirname,
    platform: input.platform,
    processArch: input.processArch,
    isPackaged: input.isPackaged,
    isDevelopment,
    appVersion: input.appVersion,
    appPath: input.appPath,
    resourcesPath,
    homeDirectory,
    appDataDirectory,
    baseDir,
    isBaseDirConfigured: isConfiguredBaseDir(config.itoHome),
    stateDir,
    desktopSettingsPath: path.join(stateDir, "desktop-settings.json"),
    clientSettingsPath: path.join(stateDir, "client-settings.json"),
    savedEnvironmentRegistryPath: path.join(stateDir, "saved-environments.json"),
    serverSettingsPath: path.join(stateDir, "settings.json"),
    logDir: path.join(stateDir, "logs"),
    browserArtifactsDir: path.join(stateDir, "browser-artifacts"),
    rootDir,
    appRoot,
    serverRoot,
    backendEntryPath: path.join(serverRoot, "apps/server/dist/bin.mjs"),
    clientAssetsDir: path.join(serverRoot, "apps/server/dist/client"),
    backendCwd: input.isPackaged ? homeDirectory : appRoot,
    preloadPath: path.join(input.dirname, "preload.cjs"),
    devServerUrl,
    devRemoteItoServerEntryPath: config.devRemoteItoServerEntryPath,
    configuredBackendPort: config.configuredBackendPort,
    commitHashOverride: config.commitHashOverride,
    otlpTracesUrl: config.otlpTracesUrl,
    otlpExportIntervalMs: config.otlpExportIntervalMs,
    otlpHeaders: config.otlpHeaders,
    otlpProtocol: config.otlpProtocol,
    branding,
    displayName,
    userDataDirName,
    legacyUserDataDirNames,
    defaultDesktopSettings: DesktopAppSettings.resolveDefaultDesktopSettings(),
    resolvePickFolderDefaultPath: (rawOptions) => {
      if (typeof rawOptions !== "object" || rawOptions === null) {
        return Option.none();
      }

      const { initialPath } = rawOptions as { initialPath?: unknown };
      if (typeof initialPath !== "string") {
        return Option.none();
      }

      const trimmedPath = initialPath.trim();
      if (trimmedPath.length === 0) {
        return Option.none();
      }

      if (trimmedPath === "~") {
        return Option.some(homeDirectory);
      }

      if (trimmedPath.startsWith("~/") || trimmedPath.startsWith("~\\")) {
        return Option.some(path.join(homeDirectory, trimmedPath.slice(2)));
      }

      return Option.some(path.resolve(trimmedPath));
    },
    resolveResourcePathCandidates: (fileName) => [
      path.join(input.dirname, "../resources", fileName),
      path.join(input.dirname, "../prod-resources", fileName),
      path.join(resourcesPath, "resources", fileName),
      path.join(resourcesPath, fileName),
    ],
  });
});

export const layer = (input: MakeDesktopEnvironmentInput) =>
  Layer.effect(DesktopEnvironment, make(input));
