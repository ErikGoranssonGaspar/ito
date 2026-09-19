# Itô

Itô is a personal, macOS-only prototype for an AI-assisted applied mathematics workspace. It currently uses the T3 Code desktop application as its starting point. The longer-term direction is described in [ITO_VISION.md](./ITO_VISION.md); no research-specific features have been added yet.

The desktop window runs the React renderer in `apps/web` and starts the local server from `apps/server`. Those directories are required for the desktop app even though Itô is not intended to offer a separate browser app or server distribution. Existing coding-agent providers, local Git tools, previews, and screen capture are retained while the prototype is evaluated.

## Run from source on macOS

Install Node 24, pnpm 11, and Vite+ (`vp`), then run:

```bash
pnpm install
pnpm dev
```

The development app uses this checkout's gitignored `.ito` directory for local state. Keep that directory if you want to retain your threads and settings. Provider sign-in is handled by each provider's own tooling.

For a focused build or type check:

```bash
pnpm build
pnpm exec vp run --filter @ito/desktop --filter @ito/web --filter @ito/server typecheck
```

After building, check that the app still launches. This takes about ten seconds and uses
a throwaway state directory, so it never touches your own:

```bash
pnpm test:desktop-smoke
```

## Documentation

The notes in `docs/internals` and `docs/operations` describe the code as it stands.
`docs/user` does not — see Known gaps.

## Repository layout

- `apps/desktop`: Electron shell, local backend startup, previews, and screen capture.
- `apps/web`: React renderer shown inside Electron.
- `apps/server`: bundled local server and coding-agent adapters.
- `packages/contracts`, `packages/client-runtime`, `packages/shared`: shared types and runtime code.
- `native`: native helpers used by the desktop app.

## Reduction status

The T3 cloud service, relay, hosted web app, account sign-in, mobile app, auto-updater,
and WSL backend are gone, along with the Windows and Linux code in the Electron shell and
the browser cookie import. `knip` reports no unused files or dependencies. What the app
does on this Mac is unchanged.

## Known gaps

Things that are deliberately unfinished, roughly in the order they are worth doing.

- **`docs/user` is stale and unreviewed.** Inherited from T3 Code, it still describes a
  hosted account, a command-line tool, and a mobile app — none of which exist here. The
  rebrand renamed it but did not review it. Read it as history, not as instructions:
  rewriting it means describing what the product now is, which is not a
  find-and-replace.
- **Non-macOS branches remain in the server and renderer**, roughly 110 `process.platform`
  checks. These need case-by-case judgement rather than a sweep: an SSH environment runs a
  server on a remote host that may not be a Mac, so a `"linux"` branch is only dead when it
  is about _this_ host. Check each against `packages/ssh` before cutting it.
- **`GitVcsDriverCore` looks flaky.** It failed once under full-suite load and passes in
  isolation.
- **There is no CI.** No workflows exist, so nothing runs the checks automatically.

Node 24 is expected (`package.json` engines); this checkout has been developed on Node 26
without trouble, but that is untested ground.
