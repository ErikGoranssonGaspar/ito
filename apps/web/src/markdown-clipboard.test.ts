import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { mathElementForSelection, serializeRenderedMarkdownFragment } from "./markdown-clipboard";
import { EnvironmentId, MessageId, ThreadId } from "@ito/contracts";
import {
  collectAssistantCitations,
  serializeAssistantCitation,
} from "@ito/shared/assistantCitations";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

class FakeText {
  readonly nodeType = TEXT_NODE;
  readonly childNodes: ReadonlyArray<never> = [];

  constructor(readonly textContent: string) {}
}

class FakeElement {
  readonly nodeType = ELEMENT_NODE;
  readonly childNodes: Array<FakeElement | FakeText> = [];
  parentElement: FakeElement | null = null;
  readonly classList = {
    contains: (name: string) => this.classNames.includes(name),
  };

  constructor(
    readonly tagName: string,
    private readonly classNames: ReadonlyArray<string> = [],
    private readonly attributes: Readonly<Record<string, string>> = {},
  ) {}

  get self(): FakeElement {
    return this;
  }

  get localName(): string {
    return this.tagName.toLowerCase();
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  get children(): ReadonlyArray<FakeElement> {
    return this.childNodes.filter((child): child is FakeElement => child instanceof FakeElement);
  }

  append(...children: Array<FakeElement | FakeText>): this {
    for (const child of children) {
      if (child instanceof FakeElement) child.parentElement = this;
    }
    this.childNodes.push(...children);
    return this;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return Object.hasOwn(this.attributes, name);
  }

  /** Supports the comma-separated `.class` and tag selectors this module asks for. */
  closest(selector: string): FakeElement | null {
    const parts = selector.split(",").map((part) => part.trim());
    const matches = (element: FakeElement) =>
      parts.some((part) =>
        part.startsWith(".")
          ? element.classList.contains(part.slice(1))
          : element.tagName === part.toUpperCase(),
      );
    const climb = (element: FakeElement | null): FakeElement | null =>
      element === null ? null : matches(element) ? element : climb(element.parentElement);
    return climb(this.self);
  }

  /** Supports only the selectors markdown-clipboard actually asks for. */
  querySelector(selector: string): FakeElement | null {
    const childOnly = selector.startsWith(":scope > ");
    const target = childOnly ? selector.slice(":scope > ".length) : selector;
    const matches = (element: FakeElement): boolean => {
      if (target === 'input[type="checkbox"]') {
        return element.tagName === "INPUT" && element.getAttribute("type") === "checkbox";
      }
      if (target === 'annotation[encoding="application/x-tex"]') {
        return (
          element.tagName === "ANNOTATION" &&
          element.getAttribute("encoding") === "application/x-tex"
        );
      }
      return element.tagName === target.toUpperCase();
    };
    const search = (parent: FakeElement): FakeElement | null => {
      for (const child of parent.childNodes) {
        if (!(child instanceof FakeElement)) continue;
        if (matches(child)) return child;
        if (!childOnly) {
          const nested = search(child);
          if (nested) return nested;
        }
      }
      return null;
    };
    return search(this);
  }
}

function asNode(element: FakeElement): Node {
  return element as unknown as Node;
}

function shikiCodeLine(text: string): FakeElement {
  const token = new FakeElement("SPAN").append(new FakeText(text));
  return new FakeElement("SPAN", ["line"]).append(token);
}

/** Mirrors a rendered code block: select-none header chrome plus a shiki pre. */
function renderedCodeBlock(lines: ReadonlyArray<string>): FakeElement {
  const code = new FakeElement("CODE");
  lines.forEach((line, index) => {
    if (index > 0) code.append(new FakeText("\n"));
    code.append(shikiCodeLine(line));
  });
  return new FakeElement("DIV", ["chat-markdown-codeblock"]).append(
    new FakeElement("DIV", ["chat-markdown-codeblock-header", "select-none"]).append(
      new FakeText("sh"),
    ),
    new FakeElement("DIV", ["chat-markdown-shiki"]).append(new FakeElement("PRE").append(code)),
  );
}

/** Mirrors KaTeX output: annotated MathML beside the aria-hidden visual spans. */
function renderedMath(tex: string, display: boolean): FakeElement {
  const mathml = new FakeElement("SPAN", ["katex-mathml"]).append(
    new FakeElement("ANNOTATION", [], { encoding: "application/x-tex" }).append(new FakeText(tex)),
  );
  const visual = new FakeElement("SPAN", ["katex-html"], { "aria-hidden": "true" }).append(
    new FakeText("glyph soup"),
  );
  const katex = new FakeElement("SPAN", ["katex"]).append(mathml, visual);
  return display ? new FakeElement("SPAN", ["katex-display"]).append(katex) : katex;
}

/**
 * A drag from one end of an equation to the other puts both endpoints inside
 * KaTeX's own spans, and `cloneContents` leaves their common ancestor out of
 * the fragment it clones — so the equation has to be recovered from the live
 * element instead. This is the lookup that finds it.
 */
describe("mathElementForSelection", () => {
  beforeEach(() => {
    vi.stubGlobal("Node", { TEXT_NODE, ELEMENT_NODE });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function displayMathTree() {
    const annotation = new FakeElement("ANNOTATION", [], {
      encoding: "application/x-tex",
    }).append(new FakeText("E = mc^2"));
    const mathml = new FakeElement("SPAN", ["katex-mathml"]).append(annotation);
    const visual = new FakeElement("SPAN", ["katex-html"], { "aria-hidden": "true" }).append(
      new FakeText("glyph soup"),
    );
    const katex = new FakeElement("SPAN", ["katex"]).append(mathml, visual);
    const display = new FakeElement("SPAN", ["katex-display"]).append(katex);
    new FakeElement("DIV", ["chat-markdown"]).append(display);
    return { display, katex, mathml, annotation, visual };
  }

  it("resolves a node inside display math to the outer element, which carries the $$ form", () => {
    const { display, mathml } = displayMathTree();

    expect(mathElementForSelection(mathml as unknown as Element)).toBe(display);
  });

  it("resolves a node inside inline math to its katex root", () => {
    const katex = new FakeElement("SPAN", ["katex"]).append(
      new FakeElement("SPAN", ["katex-mathml"]),
    );
    const inner = katex.children[0];
    new FakeElement("P").append(katex);

    expect(mathElementForSelection(inner as unknown as Element)).toBe(katex);
  });

  it("resolves a node inside unparseable math to the error element", () => {
    const error = new FakeElement("SPAN", ["katex-error"]).append(new FakeText("\\frac{1"));
    new FakeElement("P").append(error);

    expect(mathElementForSelection(error as unknown as Element)).toBe(error);
  });

  it("leaves ordinary prose alone", () => {
    const paragraph = new FakeElement("P").append(new FakeText("no math here"));
    new FakeElement("DIV", ["chat-markdown"]).append(paragraph);

    expect(mathElementForSelection(paragraph as unknown as Element)).toBe(null);
  });

  it("serializes the element it finds as a whole equation, not as glyphs", () => {
    const { mathml } = displayMathTree();
    const found = mathElementForSelection(mathml as unknown as Element);
    // What the payload builder does once it has the element: serialize that
    // in place of the partial fragment the range cloned.
    const container = new FakeElement("DIV").append(found as unknown as FakeElement);

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe("$$\nE = mc^2\n$$");
  });
});

describe("serializeRenderedMarkdownFragment", () => {
  it("copies a popover context reference once, without its details or nested label", () => {
    const reference = "[Review comment](ito-context://v1/review-comment/review-1)";
    const container = new FakeElement("DIV").append(
      new FakeText("Fix "),
      new FakeElement("BUTTON", [], { "data-markdown-copy": reference }).append(
        new FakeElement("SPAN", [], { "data-markdown-copy": reference }).append(
          new FakeText("Review comment"),
        ),
      ),
      new FakeText(" please"),
    );

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe(`Fix ${reference} please`);
  });

  beforeEach(() => {
    vi.stubGlobal("Node", { TEXT_NODE, ELEMENT_NODE });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wraps inline code in backticks", () => {
    const paragraph = new FakeElement("P").append(
      new FakeText("run "),
      new FakeElement("CODE").append(new FakeText("git status")),
      new FakeText(" first"),
    );
    const container = new FakeElement("DIV").append(paragraph);

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe("run `git status` first");
  });

  it("copies the complete quote, source, and comment instead of the comment-only chip label", () => {
    const citation = {
      version: 1 as const,
      environmentId: EnvironmentId.make("environment-one"),
      threadId: ThreadId.make("thread-one"),
      messageId: MessageId.make("assistant-one"),
      text: "A complete quote, including the part hidden by the chip preview.",
      comment: "What does this mean?\nPlease expand on the hidden part.",
      start: 0,
      end: 66,
      prefix: "",
      suffix: "",
    };
    const anchor = new FakeElement("A", [], {
      "data-markdown-copy": serializeAssistantCitation(citation),
      href: "/environment-one/thread-one#citation",
    }).append(new FakeText("What does this mean?…"));
    const chip = new FakeElement("SPAN", [], {
      "data-markdown-copy": serializeAssistantCitation(citation),
    }).append(anchor, new FakeElement("BUTTON").append(new FakeText("Edit comment")));
    const container = new FakeElement("DIV").append(new FakeText("Explain "), chip);
    const copied = serializeRenderedMarkdownFragment(asNode(container));
    expect(copied).toBe(`Explain ${serializeAssistantCitation(citation)}`);
    expect(collectAssistantCitations(copied).map((entry) => entry.citation)).toEqual([citation]);
  });

  it("keeps a highlighted block code selection plain when its pre wrapper is outside the range", () => {
    const code = new FakeElement("CODE").append(
      shikiCodeLine("git show-ref --verify refs/remotes/origin/opt/deploy/dev"),
    );
    const container = new FakeElement("DIV").append(code);

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe(
      "git show-ref --verify refs/remotes/origin/opt/deploy/dev",
    );
  });

  it("keeps a multi-line code selection plain instead of inline-wrapping it", () => {
    const code = new FakeElement("CODE").append(new FakeText("first line\nsecond line"));
    const container = new FakeElement("DIV").append(code);

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe("first line\nsecond line");
  });

  it("keeps fences when a bare list item sits alongside the code block", () => {
    // serializeListItem emits "- " for an item with no text, so the item is
    // content the plain-code path would drop.
    const container = new FakeElement("DIV").append(
      new FakeElement("UL").append(new FakeElement("LI")),
      renderedCodeBlock(["pnpm test"]),
    );

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe("-\n\n```\npnpm test\n```");
  });

  it("keeps fences when a checkbox-only task item sits alongside the code block", () => {
    // The checkbox is a skipped tag, so the item renders no text of its own, but
    // it still carries the task state.
    const container = new FakeElement("DIV").append(
      new FakeElement("UL").append(
        new FakeElement("LI").append(new FakeElement("INPUT", [], { type: "checkbox" })),
      ),
      renderedCodeBlock(["pnpm test"]),
    );

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe(
      "- [ ]\n\n```\npnpm test\n```",
    );
  });

  it("still drops fences for a code block that is the whole list item", () => {
    // The item only wraps the block, so a selection that never left the pre
    // would drop the marker too.
    const container = new FakeElement("DIV").append(
      new FakeElement("UL").append(new FakeElement("LI").append(renderedCodeBlock(["pnpm test"]))),
      new FakeText("\n"),
    );

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe("pnpm test");
  });

  it("keeps fences when a file chip sits alongside the code block", () => {
    // The chip renders as a button, a skipped tag, but its data-markdown-copy
    // still contributes markdown, so the block is not the only visible content.
    const container = new FakeElement("DIV").append(
      renderedCodeBlock(["pnpm test"]),
      new FakeText("\n"),
      new FakeElement("BUTTON", [], { "data-markdown-copy": "`src/foo.ts`" }),
    );

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe(
      "```\npnpm test\n```\n\n`src/foo.ts`",
    );
  });

  it("omits fences when a selection past the last line drags in the whole code block", () => {
    // Dragging over the final newline ends the range after the pre, so the
    // fragment carries the block plus the empty head of the next paragraph.
    const container = new FakeElement("DIV").append(
      renderedCodeBlock(["printf '%s' 'TOKEN' | gh secret set CLOUDFLARE_API_TOKEN"]),
      new FakeText("\n"),
      new FakeElement("P").append(new FakeText("")),
    );

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe(
      "printf '%s' 'TOKEN' | gh secret set CLOUDFLARE_API_TOKEN",
    );
  });

  it("still fences a code block copied alongside prose", () => {
    const container = new FakeElement("DIV").append(
      new FakeElement("P").append(new FakeText("Run this:")),
      renderedCodeBlock(["gh workflow run Deploy --ref main"]),
    );

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe(
      "Run this:\n\n```\ngh workflow run Deploy --ref main\n```",
    );
  });

  it("copies rendered math back as its LaTeX source", () => {
    const container = new FakeElement("DIV").append(
      new FakeElement("P").append(
        new FakeText("Euler: "),
        renderedMath("e^{i\\pi} + 1 = 0", false),
        new FakeText(" holds"),
      ),
      renderedMath("\\int_0^1 x\\,dx", true),
    );

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe(
      "Euler: $e^{i\\pi} + 1 = 0$ holds\n\n$$\n\\int_0^1 x\\,dx\n$$",
    );
  });

  it("copies unparseable math as the source KaTeX kept", () => {
    const container = new FakeElement("DIV").append(
      new FakeElement("P").append(
        new FakeText("Broken: "),
        new FakeElement("SPAN", ["katex-error"]).append(new FakeText("\\frac{1")),
      ),
    );

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe("Broken: $\\frac{1$");
  });

  it("uses a rendered card's explicit Markdown copy representation", () => {
    const card = new FakeElement("DIV", [], {
      "data-markdown-copy": "Hello World (Document template)\n\n",
    }).append(
      new FakeElement("SPAN").append(new FakeText("Hello World")),
      new FakeElement("SPAN").append(new FakeText("Document template")),
      new FakeElement("BUTTON").append(new FakeText("Use template")),
    );
    const container = new FakeElement("DIV").append(card);

    expect(serializeRenderedMarkdownFragment(asNode(container))).toBe(
      "Hello World (Document template)",
    );
  });
});
