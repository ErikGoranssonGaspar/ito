import { describe, expect, it } from "vite-plus/test";
import { parseInlineMarkdown } from "./composer-rich-text";

const cases = [
  "\\underbrace{a}_{0} + \\underbrace{b}_{1}",
  "$\\underbrace{a}_{0} + \\underbrace{b}_{1}$",
  "$\\sum_{i} x_i$ and $\\prod_{j} y_j$",
  "$x_{1}$",
  "$$\\int_{0}^{1} f(x)\\,dx = \\lim_{n\\to\\infty} S_n$$",
  "$a*b*c$",
  "$\\mathbb{R}^{n} \\ni x \\mapsto 2*x*3$",
  "~~$a~b~~c$~~",
];

describe("probe", () => {
  it("shows current behavior", () => {
    for (const c of cases) {
      console.log(JSON.stringify(c), "=>", JSON.stringify(parseInlineMarkdown(c)));
    }
    expect(true).toBe(true);
  });
});
