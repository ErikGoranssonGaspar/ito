# Itô

Itô is a personal macOS desktop prototype for an AI-assisted applied mathematics
workspace, built from a reduced fork of T3 Code. Read `ITO_VISION.md` for the long-term
direction.

The standing task is to build toward that vision while keeping the existing coding-agent
features working. Build a research feature when the owner asks for it, not because the
vision document mentions it. The reduction of the fork is finished; see the README for
what remains unfinished.

## Intended scope

- A desktop window on this Mac, with its local bundled server and React renderer.
- All existing coding-agent providers; terminal, file editing, Git diffs, worktrees, and
  checkpoints.
- SSH environments and the environment registry: Itô can reach servers on other machines,
  it just has no hosted account or relay.
- GitHub pull-request tools, MCP/external tools, embedded browser, screen capture,
  notifications, and local usage views until the owner has tried them.
- Run from source. No mobile app, marketing site, hosted web app, relay, T3 account or
  cloud service, updater, or release pipeline.
- Preserve existing local state. The app copies `~/.t3` and the old Application
  Support directories to their `~/.ito` counterparts on first run and leaves the
  originals alone. Never start a server against `~/.ito/userdata` or `~/.t3/userdata`,
  or edit either live directory.

## Structure

- `apps/desktop`: Electron shell and desktop services.
- `apps/web`: React renderer used by Electron. It is required even though there is no
  standalone web product.
- `apps/server`: local server and provider adapters bundled with the desktop app.
- `packages/contracts`, `packages/client-runtime`, `packages/shared`: shared code.
- `packages/ssh`, `packages/tailscale`: reaching other machines.
- `native`: the resource monitor and libghostty-vt.

## Running it

```bash
pnpm dev     # run from source; pins state to this checkout's .ito
pnpm build   # build the desktop app
```

## Checks

There is no CI. These commands are the only thing keeping the tree healthy, so run the
full set before each commit, not just the packages you touched. A regression usually
surfaces somewhere other than the file that caused it.

```bash
pnpm typecheck          # whole monorepo
pnpm lint
pnpm test               # every package; the server suite alone takes ~10 minutes
pnpm build
pnpm test:desktop-smoke # launches the built app and waits for it to report startup
```

`pnpm fmt` formats; scope it to the paths you changed, because formatting a whole
directory will reformat files that were already committed unformatted.

All of these are currently clean: typecheck and lint report nothing, and every one of the
twelve packages passes. Treat any failure as yours until you have shown otherwise.

`pnpm test` stops at the first package that fails, so a break early in the run hides
everything after it. When something fails, fix it or run the remaining packages directly
(`cd apps/server && npx vp test run`) before concluding the rest is fine.

One test has been seen to fail under full-suite load and pass in isolation
(`GitVcsDriverCore`, "keeps complete stats for files beyond the combined patch limit"). It
has not recurred. Anything else is new.

## Working safely

- Do not kill processes by a name/path match. Stop only a process you started and
  tracked, or a process group you created.
- Use a separate, gitignored `.ito` state directory for dev. Copy live data into it only
  with a consistent SQLite snapshot, and never symlink live data.
- Do not launch browser or computer-use verification without the owner's agreement.
- Do not create a pull request unless explicitly asked.
- Prefer small, coherent commits that each leave the app working. Merging future upstream
  T3 Code changes is still an open question, so this is a preference rather than a rule:
  do not let it push you toward a worse design.
- When a check fails, find out whether it already failed before your change before
  claiming it is pre-existing. `git stash` or a worktree at `HEAD` settles it.
