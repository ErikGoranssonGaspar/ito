// Smoke test: build output is launched once and must report that it started.
//
// This is deliberately shallow. It does not exercise features; it catches the
// class of breakage unit tests cannot see, where the bundle is malformed, a
// module path is wrong, or a layer fails to construct, so the app dies on
// launch. Every cut to the desktop tree should be followed by a run of this.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { resolveElectronLaunchCommand } from "./electron-launcher.mjs";

const STARTUP_TIMEOUT_MS = 90_000;
const SHUTDOWN_GRACE_MS = 5_000;

// Absence of errors is not evidence of a launch: an Electron that dies
// immediately prints none of the fatal patterns below. Startup is only
// believed when the app says these itself.
const REQUIRED_MARKERS = ["backend ready", "main window created"];
const FATAL_PATTERNS = [
  "Cannot find module",
  "MODULE_NOT_FOUND",
  "Refused to execute",
  "Uncaught Error",
  "Uncaught TypeError",
  "Uncaught ReferenceError",
];

const __dirname = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const desktopDir = NodePath.resolve(__dirname, "..");
const mainJs = NodePath.resolve(desktopDir, "dist-electron/main.cjs");

if (!NodeFS.existsSync(mainJs)) {
  console.error(`Desktop smoke test cannot run: ${mainJs} is missing.`);
  console.error("Build the desktop app first (pnpm build).");
  process.exit(1);
}

// A throwaway state directory, never the developer's own. The app would
// otherwise resolve ITO_HOME to ~/.ito and start a server against the live
// database, which is destructive to run in a loop.
const stateHome = NodeFS.realpathSync(
  NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "ito-smoke-")),
);
// Electron's own state is the other half, and ITO_HOME does not move it: it is
// derived from the home directory, so every production launch on this machine
// shares one. The single-instance lock lives there, so without this the test
// loses the lock to an Itô the developer is running, quits before it can report
// anything, and fails for a reason that has nothing to do with the build.
const userDataHome = NodePath.join(stateHome, "user-data");

console.log("\nLaunching Electron smoke test...");
console.log(`  state directory: ${stateHome}`);
console.log(`  user data directory: ${userDataHome}`);

// A terminal hosted by an Electron app (Itô's own, among others) exports
// ELECTRON_RUN_AS_NODE to its children. Inherited, it puts this launch in Node
// mode, where `require("electron")` resolves to nothing and the app dies during
// bootstrap on the first main-process API it touches. The dev and start scripts
// drop it for the same reason.
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

const electronCommand = resolveElectronLaunchCommand([mainJs]);
const child = NodeChildProcess.spawn(electronCommand.electronPath, electronCommand.args, {
  stdio: ["ignore", "pipe", "pipe"],
  // Its own process group, so the helper processes Electron spawns can be
  // stopped together by group id. Nothing is matched by name or path: only
  // the group this script created is signalled.
  detached: true,
  env: {
    ...childEnv,
    ITO_HOME: stateHome,
    ITO_DESKTOP_USER_DATA_DIR: userDataHome,
    VITE_DEV_SERVER_URL: "",
    ELECTRON_ENABLE_LOGGING: "1",
  },
});

let output = "";
let settled = false;
const seenMarkers = new Set();

const finish = (result) => {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  void stop().then(() => report(result));
};

const stop = async () => {
  const signalGroup = (signal) => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
    } catch {
      // Already gone.
    }
  };
  const exited = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", resolve);
  });
  // The app handles SIGTERM to quit cleanly; SIGKILL is the backstop so this
  // script can never be the thing that hangs.
  signalGroup("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS))]);
  signalGroup("SIGKILL");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 1_000))]);
  NodeFS.rmSync(stateHome, { recursive: true, force: true });
};

const report = (result) => {
  if (result.ok) {
    console.log("Desktop smoke test passed.");
    process.exit(0);
  }
  console.error(`\nDesktop smoke test failed: ${result.reason}`);
  console.error("\nFull output:\n" + output);
  process.exit(1);
};

const inspect = () => {
  const fatal = FATAL_PATTERNS.filter((pattern) => output.includes(pattern));
  if (fatal.length > 0) {
    finish({ ok: false, reason: `fatal output: ${fatal.join(", ")}` });
    return;
  }
  for (const marker of REQUIRED_MARKERS) {
    if (output.includes(marker)) seenMarkers.add(marker);
  }
  if (seenMarkers.size === REQUIRED_MARKERS.length) finish({ ok: true });
};

for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => {
    output += chunk.toString();
    inspect();
  });
}

child.on("error", (cause) => {
  finish({ ok: false, reason: `could not launch Electron: ${cause.message}` });
});

child.on("exit", (code, signal) => {
  // Exiting before the markers appear is a failure however calm it looks.
  const missing = REQUIRED_MARKERS.filter((marker) => !seenMarkers.has(marker));
  if (missing.length > 0) {
    finish({
      ok: false,
      reason: `Electron exited (code ${code}, signal ${signal}) without reporting: ${missing.join(", ")}`,
    });
  }
});

const timeout = setTimeout(() => {
  const missing = REQUIRED_MARKERS.filter((marker) => !seenMarkers.has(marker));
  finish({
    ok: false,
    reason: `timed out after ${STARTUP_TIMEOUT_MS}ms without reporting: ${missing.join(", ")}`,
  });
}, STARTUP_TIMEOUT_MS);
