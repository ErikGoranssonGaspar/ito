#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- This small bootstrap runs before the desktop Effect runtime exists.

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import { loadRepoEnv } from "./lib/public-config.ts";

Object.assign(process.env, loadRepoEnv());

const root = process.cwd();
const stateDir = NodePath.resolve(root, ".t3");
const gitEntry = NodePath.resolve(root, ".git");
const isLinkedWorktree = NodeFS.existsSync(gitEntry) && NodeFS.statSync(gitEntry).isFile();
const defaultOffset = isLinkedWorktree
  ? (NodeCrypto.createHash("sha256").update(root).digest().readUInt32BE(0) % 3000) + 1
  : 0;
const configuredOffset = process.env.T3CODE_PORT_OFFSET;
const startOffset = configuredOffset === undefined ? defaultOffset : Number(configuredOffset);

if (!Number.isInteger(startOffset) || startOffset < 0) {
  throw new Error("T3CODE_PORT_OFFSET must be a non-negative integer.");
}

// These ports are rejected by browsers even when a local TCP server accepts them.
const blockedWebPorts = new Set([6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697]);

const canListen = (port: number): Promise<boolean> =>
  new Promise((done) => {
    const server = NodeNet.createServer();
    server.once("error", () => done(false));
    server.listen(port, "127.0.0.1", () => server.close(() => done(true)));
  });

let ports: { server: number; web: number } | undefined;
for (let offset = startOffset; offset < startOffset + 3000; offset += 1) {
  const server = 13773 + offset;
  const web = 5733 + offset;
  if (server > 65535 || web > 65535) break;
  if (blockedWebPorts.has(web)) continue;
  if ((await canListen(server)) && (await canListen(web))) {
    ports = { server, web };
    break;
  }
}

if (!ports) {
  throw new Error("No available local ports for the desktop app.");
}

const env = {
  ...process.env,
  T3CODE_HOME: stateDir,
  T3CODE_PORT: String(ports.server),
  PORT: String(ports.web),
  HOST: "127.0.0.1",
  VITE_DEV_SERVER_URL: `http://127.0.0.1:${ports.web}`,
  VITE_HTTP_URL: `http://127.0.0.1:${ports.server}`,
  VITE_WS_URL: `ws://127.0.0.1:${ports.server}`,
  T3CODE_BUNDLED_DEV: process.env.T3CODE_BUNDLED_DEV ?? "1",
};

for (const name of [
  "T3CODE_MODE",
  "T3CODE_NO_BROWSER",
  "T3CODE_HOST",
  "T3CODE_DEV_AUTH_TOKEN",
  "T3CODE_DESKTOP_WS_URL",
  "T3CODE_SINGLE_ORIGIN_DEV",
  "T3CODE_AUTO_BOOTSTRAP_PROJECT_FROM_CWD",
  "T3_SERVICE_LAUNCHER_CONTEXT",
  "T3_BOOT_SERVICE_UNIT",
]) {
  delete env[name as keyof typeof env];
}

console.info(
  `[dev-runner] desktop serverPort=${ports.server} webPort=${ports.web} baseDir=${stateDir}`,
);

const child = NodeChildProcess.spawn("vp", ["run", "--filter=@t3tools/desktop", "--filter=@t3tools/web", "dev"], {
  cwd: root,
  env,
  stdio: "inherit",
  detached: false,
});

child.once("error", (error) => {
  console.error("Failed to start desktop development:", error);
  process.exitCode = 1;
});
child.once("close", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => child.kill(signal));
}
