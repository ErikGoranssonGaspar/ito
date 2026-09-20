/**
 * Inline markdown styling for the rich text composer.
 *
 * The composer's stored prompt stays plain markdown (`**bold**`), while the
 * Tiptap surface renders styled text. These helpers translate between the two:
 * parsing markdown into marked spans for the document, serializing marked
 * spans back to markdown in the document serializer.
 *
 * Deliberately small: bold, italic, strikethrough, and inline code only.
 * Unmatched markers stay literal text so nothing the user typed is ever lost.
 *
 * Dollar spans are literal the way inline code is. `_` and `*` are ordinary
 * LaTeX — subscripts, `\underbrace{…}_{0}`, multiplication — so reading them
 * as styling inside an equation rewrites the equation: the marks serialize
 * back as `*…*`, and the message is sent with the underscores gone.
 */

export type RichTextMark = "bold" | "italic" | "strike" | "code";

interface RichTextSpan {
  text: string;
  marks: RichTextMark[];
}

export const RICH_TEXT_DELIMITERS: Record<RichTextMark, string> = {
  bold: "**",
  italic: "*",
  strike: "~~",
  code: "`",
};

/**
 * A `$$` fence standing alone on its line, which is the only shape micromark
 * reads as a display-math block rather than inline math.
 */
export const DISPLAY_MATH_FENCE = /^[ \t]*\$\$[ \t]*$/;

/**
 * What an unclosed dollar can be followed by and still read as prose: nothing
 * or whitespace, since the renderer rejects a space-padded body too, or one of
 * the compact amounts the skill tokenizer already keeps out of chips — "$20",
 * "$100M", "$1e6", "$3.50". Anything else opens an equation.
 */
const PENDING_PROSE = /^(?:\s|$|\d[\d,._]*(?:[kKmMbBtT]|[eE]\d+)?(?:\s|$))/;

/** The length of the run of dollars starting at `index`, zero if there is none. */
function dollarRun(text: string, index: number): number {
  let end = index;
  while (text[end] === "$") end += 1;
  return end - index;
}

/**
 * The offset just past the dollar span opening at `index`, or null when those
 * dollars never close.
 *
 * Both halves of the renderer's rule land on literal text, so one span shape
 * covers them: `markdown-math.ts` sets a span like `$x_1 + y_2$` as an
 * equation, and reverts a prosaic one like `$5 and $` to the source it came
 * from. Either way the markers inside a span are characters rather than
 * styling, here as there — which is also the safe direction, since showing a
 * marker costs nothing and swallowing one changes what gets sent.
 */
function dollarSpanEnd(text: string, index: number): number | null {
  const fence = dollarRun(text, index);
  let cursor = index + fence;
  while (cursor < text.length) {
    if (text[cursor] !== "$") {
      cursor += 1;
      continue;
    }
    // micromark closes on a run of the same length; any other run is content.
    const run = dollarRun(text, cursor);
    if (run === fence) return cursor + run;
    cursor += run;
  }
  return null;
}

function pushSpan(spans: RichTextSpan[], text: string, marks: RichTextMark[]): void {
  if (!text) return;
  const last = spans[spans.length - 1];
  if (
    last &&
    last.marks.length === marks.length &&
    last.marks.every((mark, index) => mark === marks[index])
  ) {
    last.text += text;
  } else {
    spans.push({ text, marks });
  }
}

/** Parse the supported inline styles, leaving unmatched and escaped markers literal. */
export function parseInlineMarkdown(text: string): RichTextSpan[] {
  const root: RichTextSpan[] = [];
  const stack: { delimiter: string; mark: RichTextMark; spans: RichTextSpan[] }[] = [];
  const current = () => stack.at(-1)?.spans ?? root;
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\") {
      pushSpan(current(), text.slice(index, index + 2), []);
      index += 2;
      continue;
    }
    if (char === "`") {
      // Multi-backtick code stays literal; a single-backtick span owns its contents.
      const run = text.slice(index).match(/^`+/)![0];
      const close = text.indexOf(run, index + run.length);
      if (
        run.length === 1 &&
        close > index + 1 &&
        !text.slice(index, close).includes("\n") &&
        text[close + 1] !== "`"
      ) {
        pushSpan(current(), text.slice(index + 1, close), ["code"]);
        index = close + 1;
      } else {
        pushSpan(current(), run, []);
        index += run.length;
      }
      continue;
    }
    if (char === "$") {
      // Dollars that never close keep the meaning they always had: the run is
      // literal and whatever follows it still takes styling.
      const end = dollarSpanEnd(text, index) ?? index + dollarRun(text, index);
      pushSpan(current(), text.slice(index, end), []);
      index = end;
      continue;
    }
    if (char !== "*" && char !== "_" && char !== "~") {
      pushSpan(current(), char, []);
      index += 1;
      continue;
    }
    let end = index;
    while (text[end] === char) end += 1;
    const before = text[index - 1] ?? "";
    const after = text[end] ?? "";
    const canClose = before !== "" && !/\s/.test(before) && (char !== "_" || !/\w/.test(after));
    const canOpen = after !== "" && !/\s/.test(after) && (char !== "_" || !/\w/.test(before));
    while (index < end) {
      const top = stack.at(-1);
      // Inside italic, a double marker opens bold before closing the single
      // marker. Once bold is active, closing runs unwind both styles.
      const opensNestedBold =
        top?.mark === "italic" &&
        end - index === 2 &&
        canOpen &&
        (char === "*" || char === "_") &&
        !stack.some((frame) => frame.mark === "bold");
      if (
        !opensNestedBold &&
        canClose &&
        top &&
        text.startsWith(top.delimiter, index) &&
        index + top.delimiter.length <= end
      ) {
        stack.pop();
        for (const span of top.spans) pushSpan(current(), span.text, [top.mark, ...span.marks]);
        index += top.delimiter.length;
      } else if (canOpen && (char !== "~" || end - index >= 2)) {
        const length = char === "~" || end - index >= 2 ? 2 : 1;
        const mark = char === "~" ? "strike" : length === 2 ? "bold" : "italic";
        // A mark cannot nest inside itself, including alternate delimiters.
        // This bounds the stack to the supported styles for arbitrary input.
        if (stack.some((frame) => frame.mark === mark)) {
          pushSpan(current(), text.slice(index, end), []);
          index = end;
          continue;
        }
        stack.push({
          delimiter: char.repeat(length),
          mark,
          spans: [],
        });
        index += length;
      } else {
        pushSpan(current(), text.slice(index, end), []);
        index = end;
      }
    }
  }
  while (stack.length > 0) {
    const frame = stack.pop()!;
    pushSpan(current(), frame.delimiter, []);
    for (const span of frame.spans) pushSpan(current(), span.text, span.marks);
  }
  return root;
}

/**
 * Whether a line, read up to the point something is being typed into it, sits
 * inside an equation whose closing dollars have not been typed yet.
 *
 * The parse rule above cannot answer this: it recognizes a span by its closer,
 * and while you are typing there is none. So the test is weaker by necessity —
 * an unclosed dollar run opens math unless what follows it reads as prose.
 * That asymmetry is deliberate in this direction: declining to style leaves the
 * markers on screen, where firing the rule would eat the LaTeX outright.
 */
export function endsInsideOpenDollarSpan(text: string): boolean {
  for (let index = text.indexOf("$"); index >= 0; index = text.indexOf("$", index)) {
    const closed = dollarSpanEnd(text, index);
    if (closed !== null) {
      index = closed;
      continue;
    }
    const run = dollarRun(text, index);
    if (!PENDING_PROSE.test(text.slice(index + run))) return true;
    index += run;
  }
  return false;
}
