import { describe, expect, it } from "vite-plus/test";

import { collectDollarMathSpans, isInsideDollarMath } from "./composerMathSpans.ts";

/** The spans as the substrings they cover, which is what the rule is about. */
function spans(text: string): string[] {
  return collectDollarMathSpans(text).map((span) => text.slice(span.start, span.end));
}

describe("collectDollarMathSpans", () => {
  it("reads inline equations, including ones with spaces in them", () => {
    expect(spans("let $x \\in A$ be")).toEqual(["$x \\in A$"]);
    expect(spans("$x = 1$ and $y = 2$")).toEqual(["$x = 1$", "$y = 2$"]);
    expect(spans("$x$")).toEqual(["$x$"]);
    expect(spans("the $n$-th term")).toEqual(["$n$"]);
  });

  it("leaves prose dollars alone the way the renderer does", () => {
    // Content that starts or ends with whitespace, and bare amounts, are prose.
    expect(spans("costs $5 and $10 today")).toEqual([]);
    expect(spans("that is $5$ exactly")).toEqual([]);
    expect(spans("$3.50$ or $1,000$")).toEqual([]);
    expect(spans("use $HOME and $PATH here")).toEqual([]);
  });

  it("consumes a prose pair whole rather than re-reading its closing dollar", () => {
    // micromark pairs `$5 and $` first, so the dollars left over are literal —
    // resuming mid-pair here would report a `$x = 1$` the renderer never shows.
    expect(spans("costs $5 and $x = 1$ too")).toEqual([]);
  });

  it("takes $$…$$ at face value, content and all", () => {
    expect(spans("$$E = mc^2$$")).toEqual(["$$E = mc^2$$"]);
    expect(spans("costs $$5 and $$10")).toEqual(["$$5 and $$"]);
    expect(spans("$$\n  x = 1\n$$")).toEqual(["$$\n  x = 1\n$$"]);
  });

  it("does not invent a span where the renderer would find none", () => {
    // An unclosed dollar, which is what a `$skill` mention always is.
    expect(spans("run $review now")).toEqual([]);
    expect(spans("$review")).toEqual([]);
    // An equation may wrap a line, but a blank line ends the paragraph it lives
    // in, so no span reaches past one to swallow a mention below it.
    expect(spans("$x =\n1$ run $review")).toEqual(["$x =\n1$"]);
    expect(spans("$$x = 1\n\nrun $review$$")).toEqual([]);
    // An escaped dollar is a literal one.
    expect(spans("\\$x = 1\\$")).toEqual([]);
    expect(spans("$a \\$ b$")).toEqual(["$a \\$ b$"]);
  });

  it("finds the same spans in text with no dollars at all", () => {
    expect(spans("plain prose with no math")).toEqual([]);
    expect(spans("")).toEqual([]);
  });

  it("reports which offsets a span covers", () => {
    const text = "let $x = 1$ be";
    const found = collectDollarMathSpans(text);
    expect(isInsideDollarMath(found, text.indexOf("$"))).toBe(true);
    expect(isInsideDollarMath(found, text.lastIndexOf("$"))).toBe(true);
    expect(isInsideDollarMath(found, text.lastIndexOf("$") + 1)).toBe(false);
    expect(isInsideDollarMath(found, 0)).toBe(false);
  });

  it("stays fast on long text carrying many dollars", () => {
    // Re-reading the text for a paragraph break at every dollar made this
    // quadratic; the blank-line scan advances with the cursor instead.
    const text = "$a ".repeat(120_000);
    const started = performance.now();
    expect(collectDollarMathSpans(text)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("stays linear on long runs of dollars", () => {
    const dollars = "$".repeat(20_000);
    expect(spans(dollars)).toEqual([]);
    expect(spans(`${dollars}x${dollars}`)).toEqual([`${dollars}x${dollars}`]);
  });
});
