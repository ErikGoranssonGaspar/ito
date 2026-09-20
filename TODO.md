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
`composer-rich-text-doc.test.ts` are where the cases belong. The renderer's
`markdown-math.ts` is the reference for which dollar spans count as math — a bare `$5 and
$10` must stay ordinary text here too, or pasted prose stops taking styling.

**Workaround until then.** Turning off Markdown styling in settings (`richTextEnabled`)
disables the marks and their input rules, and pasted LaTeX survives verbatim.

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

**Workaround until then.** Use `$$…$$` for anything with a space in it, or keep inline
math to a single token. There is no escape: the composer has no code-span exclusion, so
backticks do not protect a `$name` either.

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
