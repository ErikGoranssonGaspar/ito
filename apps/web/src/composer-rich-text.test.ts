import { describe, expect, it } from "vite-plus/test";

import { endsInsideOpenDollarSpan, parseInlineMarkdown } from "./composer-rich-text";

describe("composer rich text markdown", () => {
  it("parses bold markers into styled spans", () => {
    expect(parseInlineMarkdown("hello **bold** world")).toEqual([
      { text: "hello ", marks: [] },
      { text: "bold", marks: ["bold"] },
      { text: " world", marks: [] },
    ]);
  });

  it("preserves unmatched markers, escaped markers, and identifiers", () => {
    for (const text of [
      "plain text",
      "snake_case",
      "unmatched **",
      "** spaced **",
      "\\*literal\\*",
    ]) {
      expect(parseInlineMarkdown(text)).toEqual([{ text, marks: [] }]);
    }
  });

  it("renders triple markers and nested styles", () => {
    expect(parseInlineMarkdown("***both***")).toEqual([
      { text: "both", marks: ["bold", "italic"] },
    ]);
    expect(parseInlineMarkdown("*a **b** c*")).toEqual([
      { text: "a ", marks: ["italic"] },
      { text: "b", marks: ["italic", "bold"] },
      { text: " c", marks: ["italic"] },
    ]);
    expect(parseInlineMarkdown("**a `code` c**")).toEqual([
      { text: "a ", marks: ["bold"] },
      { text: "code", marks: ["bold", "code"] },
      { text: " c", marks: ["bold"] },
    ]);
  });

  it("preserves crossing italic and bold spans", () => {
    expect(parseInlineMarkdown("*a**b*****c**")).toEqual([
      { text: "a", marks: ["italic"] },
      { text: "b", marks: ["italic", "bold"] },
      { text: "c", marks: ["bold"] },
    ]);
  });

  it("keeps repeated and alternate delimiters literal inside an active mark", () => {
    const repeated = "*".repeat(10_000);
    expect(parseInlineMarkdown(repeated + "text" + repeated)).toEqual([
      { text: repeated.slice(2) + "text", marks: ["bold"] },
      { text: repeated.slice(2), marks: [] },
    ]);
    const alternate = "__".repeat(5_000);
    expect(parseInlineMarkdown("**~~" + alternate + "text" + alternate + "~~**")).toEqual([
      { text: alternate + "text" + alternate, marks: ["bold", "strike"] },
    ]);
  });

  it("keeps code span contents literal", () => {
    expect(parseInlineMarkdown("`**not bold**`")).toEqual([
      { text: "**not bold**", marks: ["code"] },
    ]);
  });

  it("keeps dollar span contents literal", () => {
    for (const text of [
      "$\\underbrace{a}_{0} + \\underbrace{b}_{1}$",
      "$$\\underbrace{a}_{0} + \\underbrace{b}_{1}$$",
      "$a*b*c$",
      "$\\mathbb{R}^{n} \\ni x \\mapsto 2*x*3$",
      "$x_{1}$ and $y_{2}$",
      "$ x^2 $",
      "$$E = mc^2$$",
    ]) {
      expect(parseInlineMarkdown(text)).toEqual([{ text, marks: [] }]);
    }
  });

  it("styles the text around a dollar span", () => {
    expect(parseInlineMarkdown("let **$a_1$** be")).toEqual([
      { text: "let ", marks: [] },
      { text: "$a_1$", marks: ["bold"] },
      { text: " be", marks: [] },
    ]);
    expect(parseInlineMarkdown("*before* $a_1$ *after*")).toEqual([
      { text: "before", marks: ["italic"] },
      { text: " $a_1$ ", marks: [] },
      { text: "after", marks: ["italic"] },
    ]);
  });

  it("leaves dollars that never close to the styling rules they always had", () => {
    expect(parseInlineMarkdown("set $PATH then *run* it")).toEqual([
      { text: "set $PATH then ", marks: [] },
      { text: "run", marks: ["italic"] },
      { text: " it", marks: [] },
    ]);
    // Prose dollars still close a span, which the renderer reverts to its own
    // source; the styling after it is what has to survive.
    expect(parseInlineMarkdown("costs $5 and $10 for *two*")).toEqual([
      { text: "costs $5 and $10 for ", marks: [] },
      { text: "two", marks: ["italic"] },
    ]);
  });

  it("keeps a long line of dollars literal", () => {
    const dollars = "$ ".repeat(50_000);
    expect(parseInlineMarkdown(dollars)).toEqual([{ text: dollars, marks: [] }]);
  });

  it("reads an unclosed dollar as an equation being typed", () => {
    for (const text of [
      "$\\alpha * \\beta",
      "$2*x",
      "$x = a * b ",
      "before $$\\sum_{i} x_i * y",
      "$5 and $10 in $x = a * b",
    ]) {
      expect(endsInsideOpenDollarSpan(text)).toBe(true);
    }
  });

  it("leaves prose, amounts and closed spans alone while typing", () => {
    for (const text of [
      "",
      "plain text with *emphasis",
      "$x$ then *emphasis",
      "costs $5 and *a lot",
      "$100M raised and *then",
      "$1e6 of it, *really",
      "$3.50 each, *cheap",
      "run $ then *restart",
      "a trailing dollar $",
    ]) {
      expect(endsInsideOpenDollarSpan(text)).toBe(false);
    }
  });
});
