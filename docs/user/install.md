# Run ito on macOS

ito is currently a source-only desktop prototype. Install Node 24, pnpm 11, and Vite+, then from the repository root run:

```sh
pnpm install
pnpm dev
```

This starts the Electron window and its local backend. The app keeps its state in the checkout's gitignored `.ito` directory. Preserve that directory to retain your threads and settings.

Before starting a thread, install and authenticate at least one coding-agent provider on this Mac. You can also open **Settings → Providers** after launching ito.

| Provider    | Setup                                                         |
| ----------- | ------------------------------------------------------------- |
| Codex       | Install Codex CLI and run `codex login`.                      |
| Claude      | Install Claude Code and run `claude auth login`.              |
| Cursor      | Install Cursor CLI and run `agent login`.                     |
| Grok Build  | Install Grok Build CLI and run `grok login`.                  |
| OpenCode    | Install OpenCode and run `opencode auth login`.               |
| Antigravity | Enable it in provider settings and sign in with Google there. |

If a provider executable is not found, set its binary path in provider settings. Existing provider settings and local data are preserved through the cleanup.

See the [thread guide](./thread-sidebar.md), [permission modes](./permission-modes.md), and [source control guide](./source-control.md) for the retained desktop workflows.
