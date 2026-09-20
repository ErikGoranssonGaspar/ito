# To do

Work that is known, agreed to be worth doing, and deliberately not in flight — breakage
and wanted features both. Each entry says what is wrong or missing, where the code is, and
what a fix would have to get right, so picking one up does not mean rediscovering it.

## Inline math turns into a skill chip

`$` is the composer's skill prefix, so writing or pasting inline math claims the first
token after the dollar as a skill name. `$x = 1$` becomes a `$x` chip followed by
` = 1$`; `let $x \in A$ be` loses the same way. Only math whose body is a single token —
`$x$`, `$n$-th` — survives, because the token has to be followed by whitespace to match,
and `$$…$$` is safe for the same reason (the character after the first `$` is another
`$`). So the rule in practice is: any inline equation with a space in it breaks.

**What happens.** `SKILL_TOKEN_REGEX` (`packages/shared/src/composerInlineTokens.ts:29`)
matches `$` (any `\p{Sc}`) plus an identifier run, and `collectComposerInlineTokens`
hands it to `splitPromptIntoComposerSegments`, which emits a `skill` segment
(`apps/web/src/composer-editor-mentions.ts:131`) that Tiptap renders as an atomic chip.
The regex already carves out money — `$20`, `$100M`, `$1e6` stay prose — but nothing
knows about math. A separate trigger fires while typing: `detectComposerTrigger`
(`apps/web/src/composer-logic.ts:247`, mirrored in
`packages/shared/src/composerTrigger.ts:111`) opens the skill picker on `$` followed by
anything, so starting an equation pops up a menu.

**How bad it gets.** For a name no skill has, the chip still serializes back to `$x`, so
the text that is sent is intact and the damage is editing: the chip is one cursor
position (`collapsedSegmentLength`), so you cannot move through or backspace into the
middle of your own equation, and the sent message renders the same chip in the transcript
(`SkillInlineText.tsx:15`) instead of math. For a name that collides with a real skill it
is worse: `planClaudeSkillDispatch`
(`apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts:33`) splits the prompt around
the last such mention, rewrites it to `/name`, trims the pieces, and Claude Code runs the
skill. `CodexSessionRuntime.ts:610` and `CursorSkills.ts:23` carry the same pattern.

**Fix direction.** Teach the token scanner that a `$` opening a math span is not a skill
prefix. The renderer already decides this precisely: `prosaicDollarSource`
(`apps/web/src/markdown-math.ts:78`) treats a `$…$` span as math unless its body is
space-padded or a bare amount, which is why `$x = 1$` renders as an equation and `$5 and
$10` does not. The chip rule should agree with it, so what the composer chips and what the
transcript renders as math can never both claim the same dollar. The catch is that the
full token regex is copied five times — the shared tokenizer, the chat renderer, and the
three provider dispatchers — with the two trigger detectors carrying a looser `^\p{Sc}`
of their own. A rule added to only some of them makes the chip and the dispatch disagree,
which is the one invariant `ClaudeSkillDispatch`'s header comment promises. Tests live
next to each copy
(`composerInlineTokens.test.ts`, `composer-editor-mentions.test.ts`,
`composerTrigger.test.ts`, `ClaudeSkillDispatch.test.ts`).

**It is now the last half of the LaTeX problem.** The composer no longer mangles `_` and
`*` inside a dollar span: `parseInlineMarkdown` keeps `$…$` and `$$…$$` literal the way it
already kept inline code, `buildTiptapContent` holds a `$$` fence open across lines, and
the mark input rules stand down inside an equation (`caretInsideMath`). The chip is what
still gets in the way, in two places rather than one. `caretInsideMath` reads the line's
text and a chip carries none, so `$x` in `$x = 1$` hides its own opening dollar and
everything after it on that line is styled as prose again — asserted in
`composer-rich-text-doc.test.ts`, "cannot see an equation the skill tokenizer has already
chipped". Fixing the chip fixes that with it; nothing else needs to change there.

**Workaround until then.** Use `$$…$$` for anything with a space in it, or keep inline
math to a single token. There is no escape: the composer has no code-span exclusion, so
backticks do not protect a `$name` either.

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
