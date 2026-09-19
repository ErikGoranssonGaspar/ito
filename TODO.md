# To do

Work that is known, agreed to be worth doing, and deliberately not in flight. Each entry
says what breaks, where the code is, and what a fix would have to get right, so picking one
up does not mean rediscovering it.

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
