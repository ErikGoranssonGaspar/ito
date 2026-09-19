# Local development

ito currently runs from source on macOS. Install Node 24, pnpm 11, and Vite+, then run from the repository root:

```sh
pnpm install
pnpm dev
```

The root dev command starts the Electron app, its React renderer, and its local server. It pins state to this checkout's gitignored `.ito` directory. Never point a development server at the live `~/.ito/userdata` directory. Preserve `.ito` when cleaning or switching branches; it contains local threads and settings.

Read ports from the `[dev-runner]` line in the startup log. Worktrees derive a stable port offset from their path; an occupied port can shift it. To inspect a build without launching Electron, run `pnpm build`.

Use focused checks for changed packages and files:

```sh
pnpm exec vp run --filter @ito/desktop --filter @ito/web --filter @ito/server typecheck
pnpm exec vp test run <test-file>
```

The desktop app still uses `apps/web` for its renderer and `apps/server` for its bundled backend. These packages are needed to run the window; the fork does not publish them as independent products.
