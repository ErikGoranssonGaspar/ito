# ito

ito is a personal macOS desktop prototype for an AI-assisted applied mathematics workspace. Read `ITO_VISION.md` for the long-term direction. The current task is to reduce a T3 Code fork while keeping its useful coding-agent features. Do not add research features merely because they appear in the vision document.

## Intended scope

- Desktop window on this Mac, with its local bundled server and React renderer.
- All existing coding-agent providers; terminal, file editing, Git diffs, worktrees, and checkpoints.
- GitHub pull-request tools, MCP/external tools, embedded browser, screen capture, notifications, and local usage views until the owner has tried them.
- Run from source. No mobile app, marketing site, hosted browser app, relay deployment, T3 account/cloud service, remote connections, updater, or release pipeline.
- Preserve existing local `.t3` data and settings. Never start a server against `~/.t3/userdata` or edit that live directory.

Some unwanted upstream code is still intertwined with the desktop runtime. Keep the app buildable while removing it, and describe any remaining pieces accurately.

## Structure

- `apps/desktop`: Electron shell and desktop services.
- `apps/web`: React renderer used by Electron. It is required even though there is no standalone web product.
- `apps/server`: local server and provider adapters bundled with the desktop app.
- `packages/contracts`, `packages/client-runtime`, `packages/shared`: shared code.

## Working safely

- Do not kill processes by a name/path match. Stop only a process you started and tracked.
- Use a separate, gitignored `.t3` state directory for dev. Copy live data into it only with a consistent SQLite snapshot, and never symlink live data.
- Prefer focused build, type checks, and meaningful tests for changed paths. Do not run the full monorepo check or test suite unless asked.
- Do not launch browser or computer-use verification without the owner's agreement.
- Do not create a pull request unless explicitly asked.
- Keep future upstream merges understandable: make small, coherent cuts and verify the desktop app after each one.

Run locally with `pnpm dev`; build with `pnpm build`. The root dev script pins state to this checkout's `.t3` directory.
