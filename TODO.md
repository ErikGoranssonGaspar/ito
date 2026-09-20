# To do

Work that is known, agreed to be worth doing, and deliberately not in flight — breakage
and wanted features both. Each entry says what is wrong or missing, where the code is, and
what a fix would have to get right, so picking one up does not mean rediscovering it.

## A `$$` block inside a blockquote renders as its own source

Quoting a derivation breaks the equation in it. A fenced `$$…$$` block inside a
blockquote never renders: it comes out as literal text with the quote markers
still in it.

    > A quoted derivation:
    >
    > $$
    > dX_t = \mu X_t\,dt + \sigma X_t\,dW_t
    > $$

renders as the paragraph `$$ > dX_t = \mu X_t\,dt + \sigma X_t\,dW_t > $$`,
markers and all. Observed 2026-09-20 in the file browser's Markdown preview.

**What happens.** `createDollarMathPlugin` decides whether a `$$` block closed
by testing `CLOSING_FENCE_LINE` (`apps/web/src/markdown-math.ts:64`,
`/\n[ \t]*\$\$[ \t]*$/`) against the block's _raw document source_, which
`nodeSource` (line 67) slices by offset. Inside a blockquote that slice still
carries the `> ` prefixes micromark stripped, so the closing line reads `> $$`
and does not match. The plugin concludes the fence ran away
(line 206), `recoverRunaway` (line 125) finds no trailing `$$` and no blank
line in the node's clean value and returns null, and the fallback at line 227
replaces the equation with a paragraph of that same prefixed raw source.

**Exactly which shapes break.** Only the multi-line fenced form, and only under
a blockquote — but nesting does not save it:

| shape                  | in a blockquote |
| ---------------------- | --------------- |
| `$$\n…\n$$` fenced     | **broken**      |
| `> > $$\n…\n$$` nested | **broken**      |
| `$$…$$` on one line    | renders         |
| `$…$` inline           | renders         |
| ` ```math ` fence      | renders         |

A fenced `$$` in a _list_ item is fine, because its continuation indent is
spaces and `[ \t]*` already allows those. `>` is the only prefix that breaks
the test.

**Fix direction.** The comparison is between a de-prefixed value and a prefixed
source, so either end can move. Stripping a leading `[ \t]*>[ \t]?` run from
each line before the fence test is the small change, but note there are three
places that reason about raw source this way — the `CLOSING_FENCE_LINE` test at
line 206, the same test inside `recoverRunaway` (line 135), and the fallback at
line 227 that reinserts `nodeSource` verbatim. Fixing only the first leaves the other two
emitting prefixed text on the paths they still reach. `prosaicDollarSource` and
`loneDisplayMath` read raw source too, and both happen to be safe only because
they look at single-line spans. Tests live in `markdown-math.test.ts`; the
blockquote cases are missing there, which is why this survived.

**Workaround until then.** Inside a blockquote, write display math as a
one-line `$$…$$` or as a ` ```math ` fence. Both render correctly.

## Nothing reaches the Obsidian reference library

The vault at `~/Obsidian` holds ~479 notes in `References/`, one per source, front-matter
`tags: [reference]` and `type:`, filenames shaped `Title, Authors (Year)`. Itô cannot see
any of it: a thread can only reach files under its project cwd, so working on a problem
here means re-pasting what is already written down a directory above.

**Open question, to settle before building.** "Integration" could mean at least three
different features, and they want different code:

1. Reference lookup in the composer — a `@`-style picker that searches
   `References/` by title/author/year and attaches the note as context. This is the
   composer context-chip system: a new kind in `contextPresentationRegistry.ts` alongside
   `mention`, `file` and `skill`.
2. Read access for the agent — the vault as a second root the tools may read, which is an
   environment/permissions question on the server side, not a renderer one.
3. Citation on the way out — the agent writing `[[Author (Year)]]` links back into notes
   it produces, which overlaps with the wiki-link entry below.

**Constraint either way.** The vault is a live Git repo the owner edits in Obsidian.
Anything here reads; nothing writes into `References/` without being asked, and no feature
should assume Itô is the only process touching those files.

## The file browser opens Markdown as source, and `[[wiki links]]` are inert

Two separate gaps that show up together when reading vault notes in the file browser.

**Source is the default.** `FilePreviewPanel.tsx:965` reads the preference from
`ito.renderMarkdown` with a default of `false`, so every Markdown file opens as source
until the toggle is flipped (`renderedToggleLabel`, line 891; the toggle button, line
1122). The preference persists once set, so this is a one-word change —
`useLocalStorage(RENDER_MARKDOWN_STORAGE_KEY, true, Schema.Boolean)` — with two things to
check: a reveal request still has to win over the preference and show source
(`revealHandled`, line 991), and word wrap must stay hidden for rendered documents
(`showsRawText`, line 1009). Sibling keys `ito.renderBrowserFile` and `ito.renderTable` already default to
`true`, so this also makes Markdown consistent with them. Existing installs keep whatever
value is already stored; only fresh ones pick up the new default.

**Wiki links do nothing.** `ChatMarkdown` has no `[[…]]` syntax at all — remark never
produces a link node, so the text renders literally. Adding it means a remark plugin
before sanitizing, resolving a bare note name to a path the way Obsidian does (vault-wide
by basename, not relative to the current file), then handing the result to the existing
anchor path, which resolves via `resolvePathLinkTarget` and opens through
`openFileInPreview`. Points to get right: a link into `References/` leaves the project cwd,
which is the same permission question as the entry above; `[[Note#Heading]]` and `[[Note|alias]]` are
common — 134 of the 479 reference notes carry wiki links, 55 of them aliased and 49 with
headings — and none of those should render as broken links; an
unresolvable name should stay visibly unresolved rather than silently becoming plain text;
and `[[` must keep its literal meaning inside code fences and math.

## The sidebar spends a button on pull requests instead of a file explorer

The left sidebar's footer is an icon row — Settings, Pull Requests, Usage — and the file
tree lives only inside the thread's right panel, behind opening a file first. Wanted the
other way round: drop the Pull Requests button and give the sidebar a persistent VS
Code-style explorer occupying part of its height, so the workspace's files are visible
without opening a panel.

**What is there now.** `SidebarUtilityMenu`
(`apps/web/src/components/sidebar/SidebarChrome.tsx:122`) renders the three
`SidebarUtilityItem` buttons; the Pull Requests one (line 194) is shown when any connected
environment reports the `pullRequests` capability and navigates to `/pull-requests`
(`apps/web/src/routes/_chat.pull-requests.tsx`) carrying
`readPullRequestListPreferences()`.

**The explorer already exists.** `FileBrowserPanel`
(`apps/web/src/components/files/FileBrowserPanel.tsx`) is the tree, with search,
expand/collapse all, drag-to-mention, a context menu and refresh-on-workspace-mutation. It
takes `environmentId`, `cwd`, `projectName`, `selectedPath`, `selectedPathRevealId`,
`onOpenFile` and `workspaceMutationId`, and today is mounted in exactly one place:
`FilePreviewPanel.tsx:1294`, keyed `${environmentId}:${cwd}`, fed by `ChatView.tsx:9588`
from `activeThread.environmentId` and `activeWorkspaceRoot`. Moving it is mostly a
question of what to feed it, not of rewriting it.

**What a fix has to get right.**

- Which root, when there is no thread. The sidebar is global and persists across
  `/`, `/settings` and `/usage`, but the explorer needs an environment and a cwd. Pick
  between showing nothing, remembering the last project, or a project switcher in the
  explorer's header. `Sidebar.tsx:2240` already derives `routeThreadRef`, which is the
  hook for "what is open right now".
- Where a click lands. `onOpenFile` in the right panel ends at
  `useRightPanelStore.openFile` (`rightPanelStore.ts:137`, implementation line 578), which
  is keyed by a `ScopedThreadRef` — a file clicked with no active thread has no surface to
  open into. Decide whether the sidebar explorer is inert outside a thread or whether
  clicking starts one.
- Room in the sidebar. The width is user-resized and persisted
  (`threadSidebarWidth.ts`), and the thread list is virtualized inside `SidebarContent`
  (`Sidebar.tsx:4372`). A split needs its own persisted height and a collapsed state, and
  must not squeeze the thread list to nothing at the minimum sidebar width.
  `LegacySidebar.tsx:3625` renders the same chrome, so decide whether the legacy sidebar
  gets the explorer or just loses the button.
- Where pull requests go. The per-thread affordances are untouched
  (`ThreadPullRequestBadgeControl` / `ThreadPullRequestsMiniList`, `Sidebar.tsx:1510`), but
  the cross-thread `/pull-requests` list would lose its only entry point. It needs another
  one, or the button stays and something else moves.
- Two trees, one workspace. If the right panel keeps its own browser, both can hold
  different expansion and selection state for the same cwd (`fileTreeExpansion.ts`,
  `fileTreePathReconciliation.ts`). Share it or diverge on purpose.
- Mobile. The sidebar is an overlay there and closes on navigation
  (`closeMobileSidebar`), so an explorer inside it has to close the same way after opening
  a file.

## Interactive artifacts in the chat transcript (MCP Apps)

A tool result can only ever become text in the transcript. There is no way for a chart, a
slider over a parameter, or a small applet to appear inline the way Claude's and ChatGPT's
artifacts do — which for an applied-maths workspace is the difference between reading a
number and turning a knob on it.

**There is a standard, and it settled.** The community `mcp-ui` project was adopted as
**MCP Apps**, the first official MCP extension (SEP-1865, published 2026-01-26,
co-authored by the mcp-ui maintainers, Anthropic and OpenAI). Claude web/desktop, ChatGPT,
Goose and VS Code Insiders render it. The shape:

- A server exposes a UI resource under `ui://<server>/<id>` — bundled HTML/CSS/JS.
- A tool points at one via `_meta.ui.resourceUri` in its declaration; `_meta.ui.maxHeight`
  caps the rendered height.
- The host renders the resource in a sandboxed iframe and opens a JSON-RPC-over-
  `postMessage` channel to it. Over that channel the UI receives the tool result, calls
  server tools back, and can push text into model context.
- Host duties: fetch and cache the HTML, set the sandbox attributes, and gate
  UI-initiated tool calls behind user approval.

SDKs exist for both ends — `@modelcontextprotocol/ext-apps`, and `@mcp-ui/client` whose
`AppRenderer` is a React component with a legacy mcp-ui adapter. So neither the protocol
nor the renderer has to be invented here.

**The reference implementation to read.** opencode PR #15926, "feat: add MCP Apps support
for rich iframe UIs" — open, not merged, as of 2026-09-20. It adds `GET /mcp-app/resource`
to fetch and cache the HTML for a `ui://` URI, `POST /mcp-app/tool-call` to proxy calls
from the iframe back to the MCP server, an `AppBridge` handshake, a 640px default
`maxHeight`, and filtering to hide such tools from the model when appropriate. That is
close to the division of labour Itô would need.

**The architectural problem is which process is the host.** Itô is not an MCP client. The
`apps/server/src/mcp` directory is Itô _serving_ its own toolkits (preview, device, pull
requests) to an agent — `McpHttpServer.ts`, `McpSessionRegistry.ts`,
`McpProviderSession.ts`. External MCP servers are configured and connected by the coding
agents themselves (Claude Code, Codex, opencode), and their results reach the renderer as
`mcp_tool_call` work entries (`packages/contracts/src/providerRuntime.ts:109`), rendered
today as a `wrench` icon over a JSON dump (`MessagesTimeline.tsx:4454`). So before any
rendering work:

- **Does `_meta` survive the agent CLI?** `toolData` is typed `unknown` and passed through
  (`packages/client-runtime/src/work-log/presentation.ts:32`,
  `apps/web/src/session-logic.ts:74`), so the payload may already carry `_meta.ui`. Check
  per adapter — `ClaudeAdapter.ts`, `CodexAdapter.ts`, `OpenCodeAdapter.ts` — because an
  agent that flattens tool results to text has thrown the `resourceUri` away and no
  renderer-side work can recover it.
- **Who fetches the `ui://` resource?** If only the agent holds the MCP connection, Itô
  cannot resolve the URI itself, and the choice is between asking the agent to inline the
  HTML in the result or having Itô open its own client connection to the same server —
  which means duplicating MCP server configuration that currently lives in each agent's
  own config.
- **Where do the iframe's tool calls go?** The `postMessage` channel needs a route back to
  a live MCP session. `PreviewAutomationBroker.ts` already brokers renderer↔server↔MCP
  traffic for preview automation and is the closest existing precedent.

**What a fix has to get right.**

- Sandboxing is the whole safety story. Untrusted HTML from a third-party server runs in
  the transcript. The existing `<webview>` in `PreviewView.tsx` and the iframe in
  `BrowserDocumentFrame.tsx` are the precedents for what Itô already allows; an artifact
  frame wants tighter settings than either, and must not inherit node integration.
- Approval. UI-initiated tool calls are the model's permission problem all over again.
  `ComposerPendingApprovalPanel.tsx` is the existing surface and should be reused rather
  than a second approval path grown inside the frame.
- Transcript layout. A new block type in `MessagesTimeline.tsx` that survives
  virtualization, collapse/expand, and copy-as-Markdown — a frame that reloads on every
  scroll, or loses slider state when its row recycles, is worse than the JSON dump.
- Persistence. Artifacts have to render when a thread is reopened, so the resource HTML
  and the result payload need to live with the work entry, not only in the live session.
- Don't confuse this with `codexArtifactTemplates.ts`. Those are Codex's document,
  presentation and spreadsheet _skill templates_, unrelated to renderable UI.

**The alternative, for the record.** Generative UI as done by the Vercel AI SDK or
assistant-ui has the model emit a component the host maps to React. It needs no MCP server
and would suit a first-party "plot this" tool, but it is a per-framework convention with
no interoperability. MCP Apps is the one worth building against; a first-party plotting
toolkit inside `apps/server/src/mcp/toolkits` could then be its first consumer.
