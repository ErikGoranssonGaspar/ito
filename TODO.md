# To do

Work that is known, agreed to be worth doing, and deliberately not in flight — breakage
and wanted features both. Each entry says what is wrong or missing, where the code is, and
what a fix would have to get right, so picking one up does not mean rediscovering it.

## The composer mangles pasted LaTeX

Pasting LaTeX into the composer silently rewrites it. The markdown emphasis characters
`_` and `*` are ordinary LaTeX syntax — subscripts, `\underbrace{…}_{0}`, multiplication —
and the composer reads them as styling.

**What happens.** A paste is parsed as markdown and rebuilt as rich-text marks:
`handlePaste` (`apps/web/src/components/ComposerPromptEditorTiptap.tsx:972`) calls
`insertMarkdownParagraphs`, which calls `buildTiptapContent`
(`apps/web/src/composer-rich-text-doc.ts:166`) and, through it, `parseInlineMarkdown`
(`apps/web/src/composer-rich-text.ts:42`). Text between two underscores becomes an italic
mark, and serializing the message back to markdown writes that mark as `*…*`. The
underscores the LaTeX needed are gone by the time the message is sent.

Observed on 2026-09-19, pasting an equation back into the composer:

    \underbrace{x^2 - 2x^2 + x^2}_{0}   →   \underbrace{x^2 - 2x^2 + x^2}*{0}

which then renders as an error instead of the equation it was.

**Also check typing, not just pasting.** StarterKit's `italic` and `bold` extensions carry
input rules (`ComposerPromptEditorTiptap.tsx:731`), so typing math may convert the same
way. Both paths need the same rule or the fix only half-works.

**Fix direction.** Teach the composer's inline tokenizer about math: `$…$` and `$$…$$`
spans are literal, the way fenced and inline code already are. `parseInlineMarkdown` is the
one place that decides what a marker means, and `composer-rich-text.test.ts` /
`composer-rich-text-doc.test.ts` are where the cases belong. Which dollar spans count as
math is already settled and shared: `collectDollarMathSpans`
(`packages/shared/src/composerMathSpans.ts`) mirrors the renderer's `markdown-math.ts`,
and the skill tokenizer reads spans off it so a bare `$5 and $10` stays ordinary text.
Use it rather than writing a third copy of the rule.

**Workaround until then.** Turning off Markdown styling in settings (`richTextEnabled`)
disables the marks and their input rules, and pasted LaTeX survives verbatim.

## Display equations have no copy button

A rendered block equation can only be copied by selecting it. Fenced code blocks carry a
copy button in their header; display math carries nothing, so getting an equation back out
of a message means dragging a selection across KaTeX's spans and hoping the edges land.

**Where the pieces already are.** `MarkdownCodeBlock`
(`apps/web/src/components/ChatMarkdown.tsx:938`) is the pattern to copy from: hover header,
`copied` state that resets after 1200ms, failures routed through
`reportMarkdownActionFailure`. The TeX itself is already recoverable —
`serializeMath` (`apps/web/src/markdown-clipboard.ts:175`) reads it out of the
`annotation[encoding="application/x-tex"]` node KaTeX emits, falls back to the raw source
on `.katex-error`, and wraps display math as `$$\n…\n$$`. A button should call that same
function rather than grow a second extraction path that can disagree with selection-copy.

**What a fix has to get right.**

- Only `.katex-display` gets the button. Inline math inside a sentence must not sprout
  controls, and `markdown-math.ts` is what decides which dollar spans became display in the
  first place — a one-line `$$E = mc^2$$` alone in a paragraph is promoted there.
- Copy the `$$` delimiters, not the bare body, so the result pastes back as an equation.
  Note that pasting it into the composer currently mangles it; the LaTeX entry above is the
  other half of this round trip.
- The button must stay out of selection copies. `markdown-clipboard.ts` skips `BUTTON`
  (`SKIPPED_TAGS`) and strips buttons from the HTML flavor, so following the code-block
  precedent keeps this working — but it is worth a test, since a hover control inside the
  equation's own element is new.
- `ChatMarkdown` renders both chat messages and the file browser's Markdown preview
  (`FileMarkdownPreview.tsx`), so the button appears in both. Check it against a preview
  document, not just a thread.

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
