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

## Repository layout

- `apps/desktop`: Electron shell, local backend startup, previews, and screen capture.
- `apps/web`: React renderer shown inside Electron.
- `apps/server`: bundled local server and coding-agent adapters.
- `packages/contracts`, `packages/client-runtime`, `packages/shared`: shared types and runtime code.
- `native`: native helpers used by the desktop app.

This fork is still being reduced. Some remote, account, update, and non-macOS implementation code remains inside the retained packages and is not part of the intended ito experience.

See [TODO.md](./TODO.md) for the cleanup checklist.
