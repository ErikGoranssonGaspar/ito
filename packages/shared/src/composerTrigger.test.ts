import { describe, expect, it } from "vite-plus/test";

import { detectComposerTrigger, serializeComposerFileLink } from "./composerTrigger.ts";

describe("detectComposerTrigger", () => {
  it.each(["$", "€", "£", "¥", "₹", "₩", "₿", "𑿝"])(
    "detects %s skill prefixes and their source range",
    (prefix) => {
      const text = `Use ${prefix}review`;
      expect(detectComposerTrigger(text, text.length)).toEqual({
        kind: "skill",
        query: "review",
        rangeStart: 4,
        rangeEnd: text.length,
      });
    },
  );

  it("stays quiet on a dollar that is already an equation's delimiter", () => {
    // Cursor just after the opening `$x` of a finished equation.
    const text = "let $x = 1$ hold";
    expect(detectComposerTrigger(text, "let $x".length)).toBeNull();
    expect(detectComposerTrigger(text, text.indexOf("$") + 1)).toBeNull();
  });

  it("still opens on a mention typed alongside an equation", () => {
    const text = "given $x = 1$ run $rev";
    expect(detectComposerTrigger(text, text.length)).toEqual({
      kind: "skill",
      query: "rev",
      rangeStart: text.lastIndexOf("$rev"),
      rangeEnd: text.length,
    });
  });
});

describe("serializeComposerFileLink", () => {
  it("uses the basename as the markdown label", () => {
    expect(serializeComposerFileLink("path/to/package.json")).toBe(
      "[package.json](path/to/package.json)",
    );
  });

  it("encodes markdown-sensitive destination characters", () => {
    expect(serializeComposerFileLink("docs/My File (draft).md")).toBe(
      "[My File (draft).md](docs/My%20File%20%28draft%29.md)",
    );
  });

  it("supports windows paths", () => {
    expect(serializeComposerFileLink("C:\\repo\\src\\index.ts")).toBe(
      "[index.ts](C:%5Crepo%5Csrc%5Cindex.ts)",
    );
  });

  it("preserves paths that legitimately start with an at sign", () => {
    expect(serializeComposerFileLink("@scope/package.json")).toBe(
      "[package.json](@scope/package.json)",
    );
  });
});
