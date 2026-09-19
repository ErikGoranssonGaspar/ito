// This file mostly exists because we want dev mode to say "Itô" instead of "electron"

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { ensureElectronRuntime } from "./ensure-electron-runtime.mjs";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
export const desktopDir = NodePath.resolve(__dirname, "..");
const repoRoot = NodePath.resolve(desktopDir, "..", "..");
const devBundleIdSuffix = NodePath.basename(repoRoot)
  .toLowerCase()
  .replaceAll(/[^a-z0-9]+/g, "");
const APP_DISPLAY_NAME = "Itô";
const APP_BUNDLE_ID = isDevelopment
  ? `io.github.erikgoranssongaspar.ito.dev.${devBundleIdSuffix || "local"}`
  : "io.github.erikgoranssongaspar.ito";
const APP_PROTOCOL_SCHEMES = isDevelopment ? ["ito-dev"] : ["ito"];
const LAUNCHER_VERSION = 20;
const developmentMacIconPngPath = NodePath.join(
  repoRoot,
  "assets",
  "dev",
  "blueprint-macos-1024.png",
);
const productionMacIconPngPath = NodePath.join(repoRoot, "assets", "prod", "ito-macos-1024.png");
// oxlint-disable-next-line ito/no-global-process-runtime -- Standalone launcher script has no Effect runtime.
const hostPlatform = NodeOS.platform();

function setPlistString(plistPath, key, value) {
  const replaceResult = NodeChildProcess.spawnSync(
    "plutil",
    ["-replace", key, "-string", value, plistPath],
    {
      encoding: "utf8",
    },
  );
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = NodeChildProcess.spawnSync(
    "plutil",
    ["-insert", key, "-string", value, plistPath],
    {
      encoding: "utf8",
    },
  );
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function setPlistJson(plistPath, key, value) {
  const serialized = JSON.stringify(value);
  const replaceResult = NodeChildProcess.spawnSync(
    "plutil",
    ["-replace", key, "-json", serialized, plistPath],
    {
      encoding: "utf8",
    },
  );
  if (replaceResult.status === 0) {
    return;
  }

  const insertResult = NodeChildProcess.spawnSync(
    "plutil",
    ["-insert", key, "-json", serialized, plistPath],
    {
      encoding: "utf8",
    },
  );
  if (insertResult.status === 0) {
    return;
  }

  const details = [replaceResult.stderr, insertResult.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to update plist key "${key}" at ${plistPath}: ${details}`.trim());
}

function runChecked(command, args) {
  const result = NodeChildProcess.spawnSync(command, args, { encoding: "utf8" });
  if (result.status === 0) {
    return;
  }

  const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
  throw new Error(`Failed to run ${command} ${args.join(" ")}: ${details}`.trim());
}

export function resolveMacCodeSignArguments(appBundlePath) {
  return ["--force", "--deep", "--sign", "-", "--timestamp=none", appBundlePath];
}

function signMacLauncherBundle(appBundlePath) {
  runChecked("codesign", resolveMacCodeSignArguments(appBundlePath));
}

function shellSingleQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function makeDevelopmentEnvironmentScript(environment) {
  const envEntries = [
    ["VITE_DEV_SERVER_URL", environment.VITE_DEV_SERVER_URL],
    ["ITO_PORT", environment.ITO_PORT],
    ["ITO_HOME", environment.ITO_HOME],
    ["ITO_COMMIT_HASH", environment.ITO_COMMIT_HASH],
    ["ITO_OTLP_TRACES_URL", environment.ITO_OTLP_TRACES_URL],
    ["ITO_OTLP_EXPORT_INTERVAL_MS", environment.ITO_OTLP_EXPORT_INTERVAL_MS],
    ["ITO_OTLP_HEADERS", environment.ITO_OTLP_HEADERS],
    ["ITO_OTLP_PROTOCOL", environment.ITO_OTLP_PROTOCOL],
    ["ITO_DESKTOP_APP_USER_MODEL_ID", APP_BUNDLE_ID],
  ].filter((entry) => typeof entry[1] === "string" && entry[1].trim().length > 0);
  return [
    ...envEntries.map(
      ([name, value]) =>
        `if [ -z "\${${name}:-}" ]; then export ${name}=${shellSingleQuote(value)}; fi`,
    ),
    "",
  ].join("\n");
}

export function makeDevelopmentLauncherScript({
  electronBinaryPath,
  mainEntryPath,
  desktopRoot,
  environmentFilePath,
}) {
  return [
    "#!/bin/sh",
    `if [ -f ${shellSingleQuote(environmentFilePath)} ]; then . ${shellSingleQuote(environmentFilePath)}; fi`,
    `exec ${shellSingleQuote(electronBinaryPath)} --ito-dev-root=${shellSingleQuote(desktopRoot)} ${shellSingleQuote(mainEntryPath)} "$@"`,
    "",
  ].join("\n");
}

/**
 * The production bundle's stub, which is what Finder, the Dock and `open` run.
 * Those carry no arguments, so the entry point is baked in; they also carry no
 * shell environment, which the app repairs for itself at startup by reading a
 * login shell (see DesktopShellEnvironment).
 *
 * `VITE_DEV_SERVER_URL` is cleared because its mere presence puts the app in
 * development mode — dev state directory, dev bundle id — and this bundle has
 * already declared the production identity in its Info.plist. A value inherited
 * from whatever shell happened to launch it must not contradict that.
 */
export function makeProductionLauncherScript({ electronBinaryPath, mainEntryPath }) {
  return [
    "#!/bin/sh",
    "unset VITE_DEV_SERVER_URL",
    `exec ${shellSingleQuote(electronBinaryPath)} ${shellSingleQuote(mainEntryPath)} "$@"`,
    "",
  ].join("\n");
}

const developmentEnvironmentFilePath = NodePath.join(
  desktopDir,
  ".electron-runtime",
  "dev-environment.sh",
);

function writeDevelopmentEnvironmentScript() {
  NodeFS.mkdirSync(NodePath.dirname(developmentEnvironmentFilePath), { recursive: true });
  NodeFS.writeFileSync(
    developmentEnvironmentFilePath,
    makeDevelopmentEnvironmentScript(process.env),
  );
}

const mainEntryPath = NodePath.join(desktopDir, "dist-electron", "main.cjs");

/** True when the file had to be written, so the caller knows to re-sign. */
function writeLauncherScriptFile(targetBinaryPath, script) {
  if (
    NodeFS.existsSync(targetBinaryPath) &&
    NodeFS.readFileSync(targetBinaryPath, "utf8") === script
  ) {
    NodeFS.chmodSync(targetBinaryPath, 0o755);
    return false;
  }
  NodeFS.writeFileSync(targetBinaryPath, script);
  NodeFS.chmodSync(targetBinaryPath, 0o755);
  return true;
}

export function writeDevelopmentLauncherScript(targetBinaryPath, electronBinaryPath) {
  return writeLauncherScriptFile(
    targetBinaryPath,
    makeDevelopmentLauncherScript({
      electronBinaryPath,
      mainEntryPath,
      desktopRoot: desktopDir,
      environmentFilePath: developmentEnvironmentFilePath,
    }),
  );
}

export function writeProductionLauncherScript(targetBinaryPath, electronBinaryPath) {
  return writeLauncherScriptFile(
    targetBinaryPath,
    makeProductionLauncherScript({ electronBinaryPath, mainEntryPath }),
  );
}

function registerMacLauncherBundle(appBundlePath) {
  runChecked(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", appBundlePath],
  );

  if (!isDevelopment) {
    return;
  }

  for (const scheme of APP_PROTOCOL_SCHEMES) {
    runChecked("osascript", [
      "-l",
      "JavaScript",
      "-e",
      [
        'ObjC.import("CoreServices");',
        `const scheme = $.NSString.alloc.initWithUTF8String(${JSON.stringify(scheme)});`,
        `const bundle = $.NSString.alloc.initWithUTF8String(${JSON.stringify(APP_BUNDLE_ID)});`,
        "const status = $.LSSetDefaultHandlerForURLScheme(scheme, bundle);",
        "if (status !== 0) throw new Error(`LSSetDefaultHandlerForURLScheme failed: ${status}`);",
      ].join(" "),
    ]);
  }
}

// Bundle-internal paths are macOS paths whatever host builds them.
export function resolveMacLauncherIconPaths(runtimeDir, development = isDevelopment) {
  return {
    sourceIconPath: development ? developmentMacIconPngPath : productionMacIconPngPath,
    generatedIconPath: NodePath.posix.join(
      runtimeDir,
      development ? "icon-dev.icns" : "icon-prod.icns",
    ),
  };
}

function ensureMacIconIcns(runtimeDir) {
  const { sourceIconPath, generatedIconPath } = resolveMacLauncherIconPaths(runtimeDir);
  NodeFS.mkdirSync(runtimeDir, { recursive: true });

  if (!NodeFS.existsSync(sourceIconPath)) {
    throw new Error(`Desktop macOS icon source is missing at ${sourceIconPath}`);
  }

  const sourceMtimeMs = NodeFS.statSync(sourceIconPath).mtimeMs;
  if (
    NodeFS.existsSync(generatedIconPath) &&
    NodeFS.statSync(generatedIconPath).mtimeMs >= sourceMtimeMs
  ) {
    return generatedIconPath;
  }

  const iconsetRoot = NodeFS.mkdtempSync(NodePath.join(runtimeDir, "dev-iconset-"));
  const iconsetDir = NodePath.join(iconsetRoot, "icon.iconset");
  NodeFS.mkdirSync(iconsetDir, { recursive: true });

  try {
    for (const size of [16, 32, 128, 256, 512]) {
      runChecked("sips", [
        "-z",
        String(size),
        String(size),
        sourceIconPath,
        "--out",
        NodePath.join(iconsetDir, `icon_${size}x${size}.png`),
      ]);

      const retinaSize = size * 2;
      runChecked("sips", [
        "-z",
        String(retinaSize),
        String(retinaSize),
        sourceIconPath,
        "--out",
        NodePath.join(iconsetDir, `icon_${size}x${size}@2x.png`),
      ]);
    }

    runChecked("iconutil", ["-c", "icns", iconsetDir, "-o", generatedIconPath]);
    return generatedIconPath;
  } finally {
    NodeFS.rmSync(iconsetRoot, { recursive: true, force: true });
  }
}

export function resolveMacBundleInfoPlistStrings(executableName) {
  return {
    CFBundleDisplayName: APP_DISPLAY_NAME,
    CFBundleName: APP_DISPLAY_NAME,
    CFBundleIdentifier: APP_BUNDLE_ID,
    CFBundleExecutable: executableName,
    CFBundleIconFile: "icon.icns",
    NSScreenCaptureUsageDescription:
      "Itô captures the active window when you use the snapshot shortcut.",
    NSDocumentsFolderUsageDescription: "Itô reads project files you open in the desktop app.",
  };
}

function patchMainBundleInfoPlist(appBundlePath, iconPath, executableName) {
  const infoPlistPath = NodePath.join(appBundlePath, "Contents", "Info.plist");
  for (const [key, value] of Object.entries(resolveMacBundleInfoPlistStrings(executableName))) {
    setPlistString(infoPlistPath, key, value);
  }
  setPlistJson(infoPlistPath, "CFBundleURLTypes", [
    {
      CFBundleURLName: APP_BUNDLE_ID,
      CFBundleURLSchemes: APP_PROTOCOL_SCHEMES,
    },
  ]);

  const resourcesDir = NodePath.join(appBundlePath, "Contents", "Resources");
  NodeFS.copyFileSync(iconPath, NodePath.join(resourcesDir, "icon.icns"));
  NodeFS.copyFileSync(iconPath, NodePath.join(resourcesDir, "electron.icns"));
}

function patchHelperBundleInfoPlists(appBundlePath) {
  const helperBundleNames = [
    ["Electron Helper.app", "helper", `${APP_DISPLAY_NAME} Helper`],
    ["Electron Helper (GPU).app", "helper.gpu", `${APP_DISPLAY_NAME} Helper (GPU)`],
    ["Electron Helper (Plugin).app", "helper.plugin", `${APP_DISPLAY_NAME} Helper (Plugin)`],
    ["Electron Helper (Renderer).app", "helper.renderer", `${APP_DISPLAY_NAME} Helper (Renderer)`],
  ];

  for (const [bundleName, bundleIdentifierSuffix, bundleDisplayName] of helperBundleNames) {
    const infoPlistPath = NodePath.join(
      appBundlePath,
      "Contents",
      "Frameworks",
      bundleName,
      "Contents",
      "Info.plist",
    );
    if (!NodeFS.existsSync(infoPlistPath)) {
      continue;
    }

    setPlistString(infoPlistPath, "CFBundleDisplayName", bundleDisplayName);
    setPlistString(infoPlistPath, "CFBundleName", bundleDisplayName);
    setPlistString(
      infoPlistPath,
      "CFBundleIdentifier",
      `${APP_BUNDLE_ID}.${bundleIdentifierSuffix}`,
    );
  }
}

function readJson(path) {
  try {
    return JSON.parse(NodeFS.readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * `codesign` dies with SIGBUS, before printing anything, when a bundle's main
 * executable file name is not ASCII — so "Itô Launcher" cannot be the file on
 * disk. The bundle directory may keep the accent; only this name may not. The
 * user-visible name lives in CFBundleName and CFBundleDisplayName either way.
 */
export function toAsciiExecutableName(displayName) {
  const folded = displayName.normalize("NFD").replaceAll(/[̀-ͯ]/g, "");
  const ascii = folded.replaceAll(/[^\x20-\x7e]/g, "").trim();
  return ascii.length > 0 ? ascii : "App";
}

export function resolveMacLauncherPaths(appBundlePath, displayName = APP_DISPLAY_NAME) {
  const executableDir = NodePath.posix.join(appBundlePath, "Contents", "MacOS");
  const launcherExecutableName = `${toAsciiExecutableName(displayName)} Launcher`;
  return {
    launcherExecutableName,
    launcherBinaryPath: NodePath.posix.join(executableDir, launcherExecutableName),
    runtimeElectronBinaryPath: NodePath.posix.join(executableDir, "Electron"),
  };
}

/**
 * Writes the bundle's stub launcher, in whichever mode this process is in.
 * Both modes have one: it is the bundle's CFBundleExecutable, so it is what
 * Finder, the Dock, Spotlight and `open` run. Returns true when the file
 * changed and the bundle therefore needs signing again.
 */
function writeLauncherScriptForMode(launcherBinaryPath, runtimeElectronBinaryPath) {
  if (!isDevelopment) {
    return writeProductionLauncherScript(launcherBinaryPath, runtimeElectronBinaryPath);
  }

  // The launcher also handles protocol activations outside the dev runner,
  // so refresh its fallback environment on every launch. Never let a value
  // captured by an older parent app override the live dev-runner environment.
  writeDevelopmentEnvironmentScript();
  return writeDevelopmentLauncherScript(launcherBinaryPath, runtimeElectronBinaryPath);
}

function buildMacLauncher(electronBinaryPath) {
  const sourceAppBundlePath = NodePath.resolve(NodePath.dirname(electronBinaryPath), "../..");
  const runtimeDir = NodePath.join(desktopDir, ".electron-runtime");
  const targetAppBundlePath = NodePath.join(runtimeDir, `${APP_DISPLAY_NAME}.app`);
  const bundlePaths = resolveMacLauncherPaths(targetAppBundlePath);
  const runtimeElectronBinaryPath = bundlePaths.runtimeElectronBinaryPath;
  const stubBinaryPath = bundlePaths.launcherBinaryPath;
  // What this function hands back is what the dev runner and `start` spawn
  // directly, and they pass the entry point themselves. Production spawns the
  // Electron binary rather than the stub so those two paths keep passing
  // exactly one entry-point argument; the stub exists for the launches that
  // pass none at all.
  const launcherBinaryPath = isDevelopment ? stubBinaryPath : runtimeElectronBinaryPath;
  const iconPath = ensureMacIconIcns(runtimeDir);
  const metadataPath = NodePath.join(runtimeDir, "metadata.json");

  NodeFS.mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    sourceAppBundlePath,
    sourceAppMtimeMs: NodeFS.statSync(sourceAppBundlePath).mtimeMs,
    iconMtimeMs: NodeFS.statSync(iconPath).mtimeMs,
    appBundleId: APP_BUNDLE_ID,
    appProtocolSchemes: APP_PROTOCOL_SCHEMES,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    NodeFS.existsSync(runtimeElectronBinaryPath) &&
    NodeFS.existsSync(stubBinaryPath) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    if (writeLauncherScriptForMode(stubBinaryPath, runtimeElectronBinaryPath)) {
      signMacLauncherBundle(targetAppBundlePath);
    }
    registerMacLauncherBundle(targetAppBundlePath);
    return launcherBinaryPath;
  }

  NodeFS.rmSync(targetAppBundlePath, { recursive: true, force: true });
  // verbatimSymlinks keeps the framework's relative symlinks intact
  // (e.g. Resources -> Versions/Current/Resources). Without it cpSync
  // rewrites them to absolute paths into node_modules, which escape the
  // bundle and crash sandboxed helper processes (icudtl.dat not found).
  NodeFS.cpSync(sourceAppBundlePath, targetAppBundlePath, {
    recursive: true,
    verbatimSymlinks: true,
  });
  patchMainBundleInfoPlist(targetAppBundlePath, iconPath, bundlePaths.launcherExecutableName);
  patchHelperBundleInfoPlists(targetAppBundlePath);
  // Keep Electron's native executable inside the branded bundle. Launching the
  // node_modules copy makes macOS associate the process (and Dock label) with
  // Electron.app even though this bundle's Info.plist has the Itô name.
  // The stub only ever execs that executable, so its conventional file name
  // survives into process.execPath: Electron stays in its default-app runtime
  // rather than reporting app.isPackaged, which is what keeps the app resolving
  // the server and web assets out of this checkout.
  writeLauncherScriptForMode(stubBinaryPath, runtimeElectronBinaryPath);
  signMacLauncherBundle(targetAppBundlePath);
  NodeFS.writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);
  registerMacLauncherBundle(targetAppBundlePath);

  return launcherBinaryPath;
}

function isLinuxSetuidSandboxConfigured(electronBinaryPath) {
  if (hostPlatform !== "linux") {
    return true;
  }

  const sandboxPath = NodePath.join(NodePath.dirname(electronBinaryPath), "chrome-sandbox");
  try {
    const sandboxStat = NodeFS.statSync(sandboxPath);
    return sandboxStat.uid === 0 && (sandboxStat.mode & 0o4777) === 0o4755;
  } catch {
    return false;
  }
}

function resolveLinuxSandboxArgs(electronBinaryPath) {
  if (isLinuxSetuidSandboxConfigured(electronBinaryPath)) {
    return [];
  }

  console.warn(
    "[desktop-launcher] Electron chrome-sandbox is not root-owned with mode 4755; launching local Electron with --no-sandbox.",
  );
  return ["--no-sandbox"];
}

function resolveElectronPath() {
  const electronBinaryPath = resolveElectronBinaryPath();

  if (hostPlatform !== "darwin") {
    return electronBinaryPath;
  }

  return buildMacLauncher(electronBinaryPath);
}

export function resolveElectronLaunchCommand(args = []) {
  const electronPath = resolveElectronPath();
  return {
    electronPath,
    args: [...resolveLinuxSandboxArgs(electronPath), ...args],
  };
}

export function resolveElectronBinaryPath({
  ensureRuntime = ensureElectronRuntime,
  createRequire = NodeModule.createRequire,
  moduleUrl = import.meta.url,
} = {}) {
  ensureRuntime();

  const require = createRequire(moduleUrl);
  return require("electron");
}

export function resolveDevProtocolClient() {
  if (hostPlatform !== "darwin" || !isDevelopment) {
    return null;
  }

  const electronBinaryPath = resolveElectronBinaryPath();
  const launcherBinaryPath = buildMacLauncher(electronBinaryPath);
  return {
    appBundlePath: NodePath.resolve(launcherBinaryPath, "..", "..", ".."),
    appBundleId: APP_BUNDLE_ID,
  };
}
