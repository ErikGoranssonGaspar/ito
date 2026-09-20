/**
 * Dollar math spans in composer text, read the way the transcript renders them.
 *
 * `$` is both the composer's skill prefix and LaTeX's inline math delimiter, so
 * something has to decide which one a given dollar is. The renderer already
 * decides it: `prosaicDollarSource` in `apps/web/src/markdown-math.ts` keeps a
 * `$…$` span as math unless its content is space-padded or a bare amount, which
 * is why `$x = 1$` renders as an equation and `$5 and $10` does not. This
 * mirrors that rule so the two can never both claim the same dollar — what the
 * composer chips is exactly what the transcript would not have rendered as math.
 *
 * Pairing has to be micromark's, not a tidier rule of our own: dollars pair
 * greedily left to right, and the prose test only decides what an already-paired
 * span *means*. Resuming a scan in the middle of a pair instead would shift
 * every pairing after it by one delimiter and invent spans nothing renders —
 * which is the dangerous direction, because a span swallowing a `$skill` makes
 * it silently stop dispatching. So a span that reads as prose is still consumed
 * whole; it is just not reported.
 *
 * Neither kind of span crosses a blank line, because a blank line ends the
 * paragraph they would have to live in.
 */

export interface DollarMathSpan {
  /** Offset of the opening `$`. */
  readonly start: number;
  /** Offset just past the closing `$`. */
  readonly end: number;
}

/** A bare amount — `$5$`, `$3.50$`, `$1,000$` — is a price, not an equation. */
const BARE_AMOUNT = /^\d+(?:[.,]\d+)*$/;
const BLANK_LINE = /\n[ \t]*\n/g;

/** micromark strips one layer of symmetric padding before the value is read. */
function mathValue(raw: string): string {
  const padded = /^[ \n]/.test(raw) && /[ \n]$/.test(raw) && raw.trim() !== "";
  return padded ? raw.slice(1, -1) : raw;
}

/** Content a single-dollar span holds when it is prose rather than an equation. */
function readsAsProse(raw: string): boolean {
  const value = mathValue(raw);
  return value === "" || /^\s|\s$/.test(value) || BARE_AMOUNT.test(value);
}

/** Offset of the first blank line at or after `from`, else the end of the text. */
function nextBlankLine(text: string, from: number): number {
  BLANK_LINE.lastIndex = from;
  const blank = BLANK_LINE.exec(text);
  return blank === null ? text.length : blank.index;
}

/** Start of the next run of exactly `fence` dollars before `limit`, else null. */
function findClosingRun(text: string, from: number, fence: number, limit: number): number | null {
  let index = from;
  while (index < limit) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char !== "$") {
      index += 1;
      continue;
    }
    let end = index;
    while (end < text.length && text[end] === "$") end += 1;
    // A run of the wrong length closes nothing and opens nothing: skip it whole
    // rather than re-reading its tail as a shorter run.
    if (end - index === fence && end <= limit) return index;
    index = end;
  }
  return null;
}

/** Every dollar-delimited math span in `text`, in order and non-overlapping. */
export function collectDollarMathSpans(text: string): ReadonlyArray<DollarMathSpan> {
  const spans: DollarMathSpan[] = [];
  // Only ever advanced: a blank line behind the cursor cannot bound a later
  // span, so the whole text is scanned for blank lines once between them all.
  let blankLine = nextBlankLine(text, 0);
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char !== "$") {
      index += 1;
      continue;
    }
    let openEnd = index;
    while (text[openEnd] === "$") openEnd += 1;
    const fence = openEnd - index;
    if (blankLine < openEnd) blankLine = nextBlankLine(text, openEnd);
    const closeStart = findClosingRun(text, openEnd, fence, blankLine);
    if (closeStart === null) {
      index = openEnd;
      continue;
    }
    const start = index;
    index = closeStart + fence;
    // `$$…$$` is deliberate enough to take at face value; a single-dollar pair
    // still has to look like an equation rather than a price.
    if (fence > 1 || !readsAsProse(text.slice(openEnd, closeStart))) {
      spans.push({ start, end: index });
    }
  }
  return spans;
}

/** Whether `offset` falls inside one of `spans`. */
export function isInsideDollarMath(spans: ReadonlyArray<DollarMathSpan>, offset: number): boolean {
  return spans.some((span) => span.start <= offset && offset < span.end);
}
