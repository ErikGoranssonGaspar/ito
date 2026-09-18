# ito

ito is a personal, macOS-only prototype for an AI-assisted applied mathematics workspace. It currently uses the T3 Code desktop application as its starting point. The longer-term direction is described in [ITO_VISION.md](./ITO_VISION.md); no research-specific features have been added yet.

The desktop window runs the React renderer in `apps/web` and starts the local server from `apps/server`. Those directories are required for the desktop app even though ito is not intended to offer a separate browser app or server distribution. Existing coding-agent providers, local Git tools, previews, and screen capture are retained while the prototype is evaluated.

## Run from source on macOS

Install Node 24, pnpm 11, and Vite+ (`vp`), then run:

```bash
pnpm install
pnpm dev
```

The development app uses this checkout's gitignored `.t3` directory for local state. Keep that directory if you want to retain your threads and settings. Provider sign-in is handled by each provider's own tooling.

For a focused build or type check:

```bash
pnpm build
pnpm exec vp run --filter @t3tools/desktop --filter @t3tools/web --filter t3 typecheck
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

- **Branding.** The app still calls itself "T3 Code (Alpha)". Packages are `@t3tools/*`
  and `t3`, environment variables are `T3CODE_*`, and local state lives in `~/.t3`.
  Renaming touches the state directory, so it needs either a migration or a decision to
  keep `.t3` for data compatibility.
- **`docs/user` is stale and unreviewed.** Inherited from T3 Code, it still describes a
  hosted T3 Connect account, a `t3` command-line tool, and a mobile app — none of which
  exist here. Read it as history, not as instructions. Rewriting it is a description of
  what the product now is, so it is not a mechanical find-and-replace.
- **Non-macOS branches remain in the server and renderer**, roughly 110 `process.platform`
  checks. These need case-by-case judgement rather than a sweep: an SSH environment runs a
  server on a remote host that may not be a Mac, so a `"linux"` branch is only dead when it
  is about _this_ host. Check each against `packages/ssh` before cutting it.
- **One test fails**, and it is a real bug: `composerContextLegacy` mis-handles an
  astral-plane character immediately before an `@mention`, because `/[\p{L}...]$/u` does
  not match a surrogate pair where the equivalent `/(?:\p{L}|[...])$/u` does. It only
  affects upgrading messages from older clients.
- **`GitVcsDriverCore` looks flaky.** It failed once under full-suite load and passes in
  isolation.
- **There is no CI.** No workflows exist, so nothing runs the checks automatically.
- **`AGENTS.md` and `.agents` still carry T3-era assumptions** and want a review.

Node 24 is expected (`package.json` engines); this checkout has been developed on Node 26
without trouble, but that is untested ground.
