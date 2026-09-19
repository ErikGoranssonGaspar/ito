import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Command } from "effect/unstable/cli";

import * as NetService from "@ito/shared/Net";
import packageJson from "../package.json" with { type: "json" };
import { claudeHistoryCommand } from "./cli/claudeHistory.ts";
import { sharedServerCommandFlags } from "./cli/config.ts";
import { isEntrypoint } from "./entrypoint.ts";
import { runServerCommand } from "./cli/server.ts";

const CliRuntimeLayer = Layer.mergeAll(NodeServices.layer, NetService.layer);

// The desktop app launches this entry point as its bundled local backend.
// Claude's history worker is the only retained internal subcommand.
export const cli = Command.make("ito-server", { ...sharedServerCommandFlags }).pipe(
  Command.withDescription("Run ito's bundled local backend."),
  Command.withHandler((flags) => runServerCommand(flags)),
  Command.withSubcommands([claudeHistoryCommand]),
);

if (
  isEntrypoint({
    moduleUrl: import.meta.url,
    entryPath: process.argv[1],
    runtimeMain: import.meta.main,
  })
) {
  Command.run(cli, { version: packageJson.version }).pipe(
    Effect.scoped,
    Effect.provide(CliRuntimeLayer),
    NodeRuntime.runMain,
  );
}
