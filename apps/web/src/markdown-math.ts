import type { Processor } from "unified";

/**
 * Reads dollar math the way people write it, correcting remark-math on four
 * points before the tree reaches KaTeX.
 *
 * Prose dollars. Single-dollar math is ambiguous in a coding workspace:
 * "costs $5 and $10" and "use $HOME and $PATH" tokenize as inline math exactly
 * the way "$x^2$" does. Two shapes revert to the literal source text they came
 * from, both of them single-dollar only — `$$…$$` is deliberate enough to take
 * at face value:
 *
 * - Content that starts or ends with whitespace. micromark strips one layer of
 *   symmetric padding, so "$ x^2 $" still arrives here as "x^2" and stays math,
 *   while the stray inner space of "$5 and $10" survives to mark it as prose.
 * - A bare amount: "$5$", "$3.50$", "$1,000$".
 *
 * "$10-$15" and "$PATH$" still render as math. Both are rarer than what the
 * rules above catch, and a tighter test would start rejecting real math:
 * "$a + b$" and "$x$" carry no LaTeX syntax to be recognized by.
 *
 * Display math on one line. micromark reads `$$` as a block only when it opens
 * a line of its own, so the one-line `$$E = mc^2$$` an agent typically writes
 * arrives as inline math and renders at inline size. A paragraph holding
 * nothing else becomes a display equation, which is what both GitHub and the
 * author meant. Mid-sentence `$$…$$` stays inline.
 *
 * Runaway blocks. A closing `$$` has to stand on its own line; when it trails
 * the last line of the equation instead — `… + 1 .$$`, which agents write
 * constantly — micromark finds no fence and swallows the entire rest of the
 * message into one equation, which KaTeX then renders as a wall of red source.
 * A block left open at the end of the document is therefore cut back at its
 * first trailing `$$` or, failing that, at its first blank line, and whatever
 * followed is parsed as the markdown it was meant to be. One that offers
 * neither — the usual shape of an equation still streaming in — renders as its
 * own source text until the rest of it lands.
 *
 * Tagged equations. `\tag` is a display-only command: KaTeX refuses it inline
 * and renders the whole equation as red source instead. An author who numbers
 * an equation meant it to stand on its own, so a single-dollar span carrying a
 * `\tag` and occupying a whole line of its own is lifted out of the prose
 * around it and rendered as a display block. Anything less — a `\tag`
 * mid-sentence — is left alone, because splitting a line there would break the
 * sentence it sits in.
 */

interface MathPoint {
  offset?: number | undefined;
  line?: number | undefined;
}

interface MathPosition {
  start?: MathPoint | undefined;
  end?: MathPoint | undefined;
}

interface MathAstNode {
  type?: string;
  value?: unknown;
  data?: Record<string, unknown> | undefined;
  position?: MathPosition | undefined;
  children?: MathAstNode[];
}

interface MathVFile {
  value?: unknown;
}

const BARE_AMOUNT = /^\d+(?:[.,]\d+)*$/;
const DISPLAY_FENCE = "$$\n";
const TRAILING_CLOSER = /\$\$[ \t]*$/;
const CLOSING_FENCE_LINE = /\n[ \t]*\$\$[ \t]*$/;
const TAG_COMMAND = /\\tag\*?\s*\{/;
const LEADING_SOFT_BREAK = /^[ \t]*\n[ \t]*/;
const TRAILING_SOFT_BREAK = /[ \t]*\n[ \t]*$/;

/** The node's own source text, read through its position. */
function nodeSource(node: MathAstNode, source: string): string | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return null;
  return source.slice(start, end);
}

/** The node's own source text when it reads as prose rather than math, else null. */
function prosaicDollarSource(node: MathAstNode, source: string): string | null {
  if (node.type !== "inlineMath") return null;
  const raw = nodeSource(node, source);
  if (raw === null || !raw.startsWith("$") || raw.startsWith("$$")) return null;

  const value = typeof node.value === "string" ? node.value : "";
  return /^\s|\s$/.test(value) || BARE_AMOUNT.test(value) ? raw : null;
}

/** The shape mdast-util-math gives a `$$` block, which rehype-katex reads as display mode. */
function displayMath(value: string, position: MathPosition | undefined): MathAstNode {
  return {
    type: "math",
    value,
    position,
    data: {
      hName: "pre",
      hChildren: [
        {
          type: "element",
          tagName: "code",
          properties: { className: ["language-math", "math-display"] },
          children: [{ type: "text", value }],
        },
      ],
    },
  };
}

function isBlank(node: MathAstNode): boolean {
  return node.type === "text" && typeof node.value === "string" && node.value.trim() === "";
}

/** A paragraph whose only content is one `$$…$$` span, as a display equation. */
function loneDisplayMath(node: MathAstNode, source: string): MathAstNode | null {
  if (node.type !== "paragraph") return null;
  const content = node.children?.filter((child) => !isBlank(child)) ?? [];
  const [math] = content;
  if (content.length !== 1 || math?.type !== "inlineMath") return null;
  if (!nodeSource(math, source)?.startsWith("$$")) return null;

  const value = typeof math.value === "string" ? math.value : "";
  return displayMath(value, node.position);
}

/** Whether the node has its source line to itself, prose-free on both sides. */
function standsAloneOnLine(node: MathAstNode, source: string): boolean {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return false;
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = source.indexOf("\n", end);
  return (
    source.slice(lineStart, start).trim() === "" &&
    source.slice(end, lineEnd === -1 ? source.length : lineEnd).trim() === ""
  );
}

/** A numbered equation written on a line of its own, as a display equation. */
function taggedDisplayMath(node: MathAstNode, source: string): MathAstNode | null {
  if (node.type !== "inlineMath") return null;
  const value = typeof node.value === "string" ? node.value : "";
  if (!TAG_COMMAND.test(value) || !standsAloneOnLine(node, source)) return null;
  return displayMath(value, node.position);
}

/**
 * One paragraph's worth of nodes, without the soft break the equation next to
 * them was separated by. Only the edges are touched: the spaces between a
 * paragraph's own words are part of it.
 */
function trimmedSegment(nodes: MathAstNode[]): MathAstNode | null {
  const children = [...nodes];
  for (const edge of [
    { index: 0, pattern: LEADING_SOFT_BREAK },
    { index: children.length - 1, pattern: TRAILING_SOFT_BREAK },
  ]) {
    const node = children[edge.index];
    if (node?.type !== "text" || typeof node.value !== "string") continue;
    children[edge.index] = { ...node, value: node.value.replace(edge.pattern, "") };
  }

  const blank = (node: MathAstNode | undefined) => node !== undefined && isBlank(node);
  while (blank(children[0])) children.shift();
  while (blank(children[children.length - 1])) children.pop();

  const [first] = children;
  const last = children[children.length - 1];
  if (first === undefined || last === undefined) return null;
  return {
    type: "paragraph",
    children,
    position: { start: first.position?.start, end: last.position?.end },
  };
}

/**
 * A paragraph with its tagged equations hoisted out into display blocks of
 * their own, and the prose between them kept as paragraphs. Null when the
 * paragraph holds no equation to hoist.
 */
function hoistTaggedEquations(node: MathAstNode, source: string): MathAstNode[] | null {
  const children = node.type === "paragraph" ? (node.children ?? []) : [];
  if (!children.some((child) => taggedDisplayMath(child, source) !== null)) return null;

  const blocks: MathAstNode[] = [];
  let prose: MathAstNode[] = [];
  for (const child of children) {
    const equation = taggedDisplayMath(child, source);
    if (equation === null) {
      prose.push(child);
      continue;
    }
    const segment = trimmedSegment(prose);
    if (segment !== null) blocks.push(segment);
    blocks.push(equation);
    prose = [];
  }
  const tail = trimmedSegment(prose);
  if (tail !== null) blocks.push(tail);
  return blocks;
}

/**
 * Where a `$$` block left open at the end of the document should have ended,
 * as the equation itself and the source offset the rest of the message starts
 * at. Null when the block offers no end to find.
 */
function recoverRunaway(
  node: MathAstNode,
  source: string,
): { readonly value: string; readonly remainderStart: number } | null {
  if (node.type !== "math") return null;
  const start = node.position?.start?.offset;
  const raw = nodeSource(node, source);
  if (typeof start !== "number" || raw === null) return null;
  // An indented or meta-carrying fence does not map onto the source one
  // character at a time, and a closing fence line means nothing ran away.
  if (!raw.startsWith(DISPLAY_FENCE) || CLOSING_FENCE_LINE.test(raw)) return null;

  const lines = (typeof node.value === "string" ? node.value : "").split("\n");
  let offset = start + DISPLAY_FENCE.length;
  for (const [index, line] of lines.entries()) {
    const closer = TRAILING_CLOSER.exec(line);
    if (closer) {
      return {
        value: [...lines.slice(0, index), line.slice(0, closer.index)].join("\n"),
        remainderStart: Math.min(offset + line.length + 1, source.length),
      };
    }
    // The blank line an equation never contains, but the prose after it does.
    if (index > 0 && line.trim() === "") {
      return { value: lines.slice(0, index).join("\n"), remainderStart: offset };
    }
    offset += line.length + 1;
  }
  return null;
}

/** Re-anchors a subtree parsed on its own onto the document it came from. */
function shiftPositions(node: MathAstNode, offsetDelta: number, lineDelta: number): void {
  for (const point of [node.position?.start, node.position?.end]) {
    if (!point) continue;
    if (typeof point.offset === "number") point.offset += offsetDelta;
    if (typeof point.line === "number") point.line += lineDelta;
  }
  node.children?.forEach((child) => shiftPositions(child, offsetDelta, lineDelta));
}

/**
 * One plugin instance per plugin list. Recovering a runaway block means
 * parsing the message it swallowed, which needs the processor unified attached
 * this to — `this` on the attacher, so the attacher cannot be the export.
 */
export function createDollarMathPlugin() {
  return function (this: Processor | undefined) {
    const parseMarkdown = this?.parse?.bind(this) ?? null;
    const parse =
      parseMarkdown === null
        ? null
        : (text: string): MathAstNode => parseMarkdown(text) as unknown as MathAstNode;

    return (tree: MathAstNode, file: MathVFile) => {
      const source = typeof file.value === "string" ? file.value : null;
      // Without the source there is no way to tell `$x$` from `$$x$$`, and the
      // reverted text could not be reproduced faithfully either.
      if (source === null) return;

      const visit = (node: MathAstNode) => {
        const children = node.children;
        if (!children) return;
        for (let index = 0; index < children.length; index += 1) {
          const child = children[index];
          if (!child) continue;

          const prose = prosaicDollarSource(child, source);
          if (prose !== null) {
            children[index] = { type: "text", value: prose, position: child.position };
            continue;
          }

          const lone = loneDisplayMath(child, source);
          if (lone !== null) {
            children[index] = lone;
            continue;
          }

          const hoisted = hoistTaggedEquations(child, source);
          if (hoisted !== null) {
            children.splice(index, 1, ...hoisted);
            // Step back onto the first block the split produced: none of them
            // holds a tagged equation any more, so this cannot loop.
            index -= 1;
            continue;
          }

          // A `$$` fence micromark found in the source, as opposed to a
          // display equation this plugin built out of a single-dollar span,
          // which has no fence of its own to have left open.
          const fenced = nodeSource(child, source)?.startsWith("$$") === true;
          if (
            child.type === "math" &&
            fenced &&
            !CLOSING_FENCE_LINE.test(nodeSource(child, source) ?? "$$\n$$")
          ) {
            const recovered = parse === null ? null : recoverRunaway(child, source);
            if (recovered !== null) {
              const remainder = source.slice(recovered.remainderStart);
              const parsed = parse === null ? null : parse(remainder);
              const lineDelta = source.slice(0, recovered.remainderStart).split("\n").length - 1;
              parsed?.children?.forEach((node) =>
                shiftPositions(node, recovered.remainderStart, lineDelta),
              );
              children.splice(
                index,
                1,
                displayMath(recovered.value, {
                  start: child.position?.start,
                  end: { offset: recovered.remainderStart },
                }),
                ...(parsed?.children ?? []),
              );
              continue;
            }
            // Nothing to recover: an equation still arriving, or one whose
            // closing fence never came. Show the source rather than KaTeX's
            // complaint about it.
            const raw = nodeSource(child, source);
            if (raw !== null) {
              children[index] = {
                type: "paragraph",
                position: child.position,
                children: [{ type: "text", value: raw, position: child.position }],
              };
              continue;
            }
          }

          visit(child);
        }
      };

      visit(tree);
    };
  };
}
