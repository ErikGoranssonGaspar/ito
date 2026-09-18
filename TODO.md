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
- [x] Reduce the server's external browser, editor, and file-manager launcher to macOS behavior.
- [x] Remove Linux desktop-entry URL registration and pre-ready password-store setup from the Electron startup path.
- [x] Remove the unused Linux password-store setting and its helper.
- [x] Remove the Linux browser-secret helper and Chromium cookie import path from the desktop build.
- [x] Remove the GNOME, KDE, Hyprland, Niri, and xdg-portal screen-capture backends, the
      Windows capture overlay and region worker, and their setup UI, leaving macOS capture.
- [x] Remove the desktop auto-updater: electron-updater, update channels and release notes,
      the update IPC and sidebar/settings update UI, and the server's desktop-update bridge.
- [x] Remove the WSL backend: its environment probe, server tree, path helpers, orchestrator,
      settings, IPC and Connections UI, collapsing the backend pool to the single local backend.
- [x] Remove the server's own self-update: the npm/archive distribution path, the background
      service launcher and its protocol, and the server-update RPCs, state, and UI.
- [x] Remove the T3 cloud service and relay: the server's cloud link, CLI token manager,
      managed endpoint runtime and awareness relay; the renderer's T3 Connect onboarding,
      DPoP client auth, managed-relay state and hosted-browser pairing; the relay connection
      target; and the cloudflared relay-client installer with its RPCs. SSH environments and
      the environment registry are kept.
- [x] Remove the server's DPoP proof-of-possession auth, which only relay and
      hosted-browser clients ever used, and delete the orphaned relay protocol contract.
- [x] Remove links into the T3-hosted web app: hosted pairing URLs, the hosted app
      channel selection, the CLI's hosted Clerk OAuth helper, and the "reachable from a
      hosted HTTPS app" endpoint compatibility.
- [x] Reduce the browser cookie import to macOS: drop the Windows DPAPI key path and
      AES-GCM records, the Windows and Linux profile roots and lock probes, and the
      per-source platform lists.
- [x] Collapse the renderer's hosted-static-app mode. `isHostedStaticApp()` is gone and
      the `hosted-static` auth-gate state is renamed `no-local-backend`, which is the only
      way it was ever reachable here.
- [x] Prune the dependencies the cuts made dead: Clerk (the T3 account sign-in), jose and
      @noble/curves (relay JWT and DPoP), dbus-next and its patch, electron-store, and the
      unused @effect/platform-node-shared direct dependency.
- [x] Remove the Windows and Linux branches from the Electron shell: the PowerShell
      environment probe, the Linux D-Bus and XDG session plumbing, the Windows taskbar
      overlay and app-user-model id, the AppImage and desktop-entry identity, and the
      per-platform window icon and editing chords.
- [x] Prune the license overrides for packages the cuts removed, and correct the internals
      docs that describe code that changed (environment auth, connection runtime,
      architecture overview, glossary, composer context, devices).
- [x] Preserve this checkout's `.t3` data and settings.

## Next cleanup passes

- [ ] Remove the remaining Windows and Linux branches from the server and renderer.
      Care needed: an SSH environment runs a remote t3 server that may well be Linux,
      so a `"linux"` branch is only dead when it is about *this* host. Check each one
      against `packages/ssh` before cutting it.
- [ ] Rewrite the user documentation in `docs/user`. It still describes T3 Connect, the
      `t3` CLI (`t3 serve`, `t3 pair`, `t3 connect`), and the mobile app — about 40
      mentions across 12 files. This describes what the product *is*, so it wants the
      owner's view rather than a mechanical find-and-replace.
- [ ] After each substantial cut, run focused checks and verify the macOS desktop app still starts.
- [ ] Once the cleanup is finished, review `AGENTS.md` and the related agent setup files in `.agents` with the owner. Keep useful instructions and skills, and remove or update T3-era assumptions for ito.

Keep all current coding-agent providers, terminal, editing, Git tools, checkpoints, GitHub pull-request tools, MCP, preview/browser, screen capture, notifications, and local activity views until the owner has tried them.
