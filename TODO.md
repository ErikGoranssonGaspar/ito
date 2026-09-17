# ito cleanup checklist

This tracks the reduction of the T3 Code fork. The longer-term product direction is in
[ITO_VISION.md](./ITO_VISION.md). No research features are part of this cleanup.

## Completed

- [x] Build and launch the macOS desktop app from source with its local backend.
- [x] Remove the standalone mobile app, marketing site, relay deployment, hosted web deployment, and their release infrastructure.
- [x] Remove the standalone server distribution and several Windows/Linux desktop workers and packaging paths.
- [x] Remove the Electron T3 account bridge and its unused Clerk package, while keeping provider sign-in.
- [x] Remove CodeRabbit, Macroscope, Cursor Cloud, VS Code, and iOS simulator project configuration, Git hooks, and vendored reference repositories.
- [x] Remove T3 account profile and mobile-device pages from the settings sidebar.
- [x] Preserve this checkout's `.t3` data and settings.

## Next cleanup passes

- [ ] Trace and remove remaining T3 account, relay, remote connection, and hosted-browser code shared with the desktop renderer and server.
- [ ] Remove remaining Windows, Linux, WSL, updater, and distribution code from retained packages.
- [ ] Prune dependencies, license overrides, tests, and documentation made obsolete by those cuts.
- [ ] Review `.agents` with the owner and keep or adapt useful skills for the applied mathematics workspace.
- [ ] After each substantial cut, run focused checks and verify the macOS desktop app still starts.

Keep all current coding-agent providers, terminal, editing, Git tools, checkpoints, GitHub pull-request tools, MCP, preview/browser, screen capture, notifications, and local activity views until the owner has tried them.
