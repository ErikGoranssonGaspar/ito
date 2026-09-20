import { describe, expect, it } from "vite-plus/test";

import { createDollarMathPlugin } from "./markdown-math";

interface TestNode {
  type?: string;
  value?: unknown;
  position?: { start?: { offset?: number }; end?: { offset?: number } };
  children?: TestNode[];
}

/** The attacher, standing in for the processor unified would pass. */
const dollarMath = () => createDollarMathPlugin().call(undefined);

/** A one-paragraph document holding a single math node. */
function paragraphWithMath(math: TestNode): TestNode {
  return { type: "root", children: [{ type: "paragraph", children: [math] }] };
}

function mathNode(source: string, span: string, value: string): TestNode {
  const start = source.indexOf(span);
  return {
    type: "inlineMath",
    value,
    position: { start: { offset: start }, end: { offset: start + span.length } },
  };
}

function guard(tree: TestNode, source: string): TestNode[] {
  dollarMath()(tree, { value: source });
  return tree.children?.[0]?.children ?? [];
}

describe("createDollarMathPlugin", () => {
  it("restores the source text of a dollar span that reads as prose", () => {
    const source = "costs $5 and $10 today";
    const tree = paragraphWithMath(mathNode(source, "$5 and $", "5 and "));

    expect(guard(tree, source)).toEqual([
      { type: "text", value: "$5 and $", position: { start: { offset: 6 }, end: { offset: 14 } } },
    ]);
  });

  it("trusts $$…$$ even when its content reads as prose", () => {
    const source = "costs $$5 and $$10 today";
    const tree: TestNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "costs " },
            mathNode(source, "$$5 and $$", "5 and "),
            { type: "text", value: "10 today" },
          ],
        },
      ],
    };

    expect(guard(tree, source)[1]?.type).toBe("inlineMath");
  });

  it("lifts a paragraph that holds nothing but $$…$$ into a display equation", () => {
    const source = "$$E = mc^2$$";
    const tree = paragraphWithMath(mathNode(source, source, "E = mc^2"));

    dollarMath()(tree, { value: source });

    expect(tree.children?.[0]).toMatchObject({
      type: "math",
      value: "E = mc^2",
      data: { hName: "pre" },
    });
  });

  it("splits the prose around a tagged equation written on its own line", () => {
    const source = "Define\n$x = 1 \\tag{1}$\nas above";
    const tree: TestNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "Define\n" },
            mathNode(source, "$x = 1 \\tag{1}$", "x = 1 \\tag{1}"),
            { type: "text", value: "\nas above" },
          ],
        },
      ],
    };

    dollarMath()(tree, { value: source });

    expect(tree.children?.map((child) => child.type)).toEqual(["paragraph", "math", "paragraph"]);
    expect(tree.children?.[1]).toMatchObject({ value: "x = 1 \\tag{1}", data: { hName: "pre" } });
    expect(tree.children?.[0]?.children).toEqual([{ type: "text", value: "Define" }]);
    expect(tree.children?.[2]?.children).toEqual([{ type: "text", value: "as above" }]);
  });

  it("leaves a tagged equation that shares its line with prose inline", () => {
    const source = "As $x = 1 \\tag{1}$ shows";
    const tree: TestNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "As " },
            mathNode(source, "$x = 1 \\tag{1}$", "x = 1 \\tag{1}"),
            { type: "text", value: " shows" },
          ],
        },
      ],
    };

    dollarMath()(tree, { value: source });

    expect(tree.children?.[0]?.children?.[1]?.type).toBe("inlineMath");
  });

  it("keeps the spacing between the words a split paragraph keeps", () => {
    const source = "**Bold** *and* italic\n$x \\tag{1}$";
    const tree: TestNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "strong", children: [{ type: "text", value: "Bold" }] },
            { type: "text", value: " " },
            { type: "emphasis", children: [{ type: "text", value: "and" }] },
            { type: "text", value: " italic\n" },
            mathNode(source, "$x \\tag{1}$", "x \\tag{1}"),
          ],
        },
      ],
    };

    dollarMath()(tree, { value: source });

    expect(tree.children?.[0]?.children?.map((child) => child.value)).toEqual([
      undefined,
      " ",
      undefined,
      " italic",
    ]);
    expect(tree.children?.[1]?.type).toBe("math");
  });

  it("keeps math it cannot locate in the source", () => {
    const source = "costs $5 and $10 today";
    const tree = paragraphWithMath({ type: "inlineMath", value: "5 and " });

    expect(guard(tree, source)[0]?.type).toBe("inlineMath");
  });

  it("guards math nested inside other inline markup", () => {
    const source = "*costs $5 and $10 today*";
    const tree: TestNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "emphasis", children: [mathNode(source, "$5 and $", "5 and ")] }],
        },
      ],
    };

    dollarMath()(tree, { value: source });

    expect(tree.children?.[0]?.children?.[0]?.children?.[0]?.type).toBe("text");
  });

  it("leaves the tree alone when the source is unavailable", () => {
    const source = "costs $5 and $10 today";
    const tree = paragraphWithMath(mathNode(source, "$5 and $", "5 and "));

    dollarMath()(tree, {});

    expect(tree.children?.[0]?.children?.[0]?.type).toBe("inlineMath");
  });
});
