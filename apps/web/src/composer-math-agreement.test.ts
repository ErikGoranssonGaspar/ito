import { describe, expect, it } from "vite-plus/test";
import { collectDollarMathSpans } from "@ito/shared/composerMathSpans";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { createDollarMathPlugin } from "./markdown-math";

/**
 * The composer's chip rule and the transcript's math rule must never both claim
 * the same dollar: a `$` the renderer turns into an equation cannot also be a
 * skill prefix. `collectDollarMathSpans` is a hand-written scanner and the
 * renderer is micromark, so the only honest check is to run both.
 */

interface Node {
  readonly type?: string;
  readonly position?: { start?: { offset?: number }; end?: { offset?: number } };
  readonly children?: ReadonlyArray<Node>;
}

/** The renderer's own parser, up to the point the dollar guard runs. */
const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
/** The guard attached to that processor, as `remarkPlugins` would attach it. */
const guardDollarMath = createDollarMathPlugin().call(parser as never);

/** The spans the rendered tree ends up treating as math, as their source text. */
function renderedMath(source: string): string[] {
  const tree = parser.parse(source) as Node;
  guardDollarMath(tree as never, { value: source });
  const found: string[] = [];
  const visit = (node: Node) => {
    if (node.type === "math" || node.type === "inlineMath") {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (typeof start === "number" && typeof end === "number")
        found.push(source.slice(start, end));
      return;
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  return found;
}

const CORPUS = [
  "$x = 1$",
  "let $x \\in A$ be",
  "the $n$-th term",
  "$x = 1$ and $y = 2$",
  "$$E = mc^2$$",
  "a $$x = 1$$ mid sentence",
  "costs $5 and $10 today",
  "that is $5$ exactly",
  "$3.50$ or $1,000$",
  "use $HOME and $PATH here",
  "costs $5 and $x = 1$ too",
  "run $review now",
  "$review",
  "Use $deploy and then $verify",
  "$x =\nstill going$ here",
  "$ x^2 $ padded",
  "text with no dollars at all",
  "$a + b$ then $c$",
  "one $10-$15 range",
  "\\$x = 1\\$ escaped",
];

describe("composer chip rule versus the transcript math rule", () => {
  it("claims exactly the dollars the renderer treats as math", () => {
    for (const source of CORPUS) {
      const scanned = collectDollarMathSpans(source).map((span) =>
        source.slice(span.start, span.end),
      );
      // The source rides along so a failure names the case that broke.
      expect([source, scanned]).toEqual([source, renderedMath(source)]);
    }
  });

  it("is checking a pipeline that finds math at all", () => {
    // Without this the agreement above would also hold if `renderedMath` had
    // quietly stopped reading the tree and returned nothing every time.
    expect(renderedMath("$x = 1$")).toEqual(["$x = 1$"]);
    expect(renderedMath("$$E = mc^2$$")).toEqual(["$$E = mc^2$$"]);
    expect(CORPUS.filter((source) => renderedMath(source).length > 0).length).toBeGreaterThan(5);
  });
});
