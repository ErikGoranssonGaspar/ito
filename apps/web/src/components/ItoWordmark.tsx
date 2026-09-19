import type { SVGProps } from "react";

// The box's bottom edge is the baseline, and its 80 units of height clear the
// circumflex at this font size, so an inline <svg> sits on the surrounding
// text's baseline without the accent being clipped. The width is the natural
// advance of "Itô" in the system UI font; `lengthAdjust="spacing"` absorbs the
// difference for anyone who has overridden --font-sans, by nudging the
// letter-spacing rather than distorting the glyphs.
const WORDMARK_WIDTH = 126;
const WORDMARK_HEIGHT = 80;

/**
 * The app naming itself. Typographic rather than pictorial: it has to stay
 * legible at cap height beside a project name, which the drawn mark does not.
 */
export function ItoWordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      viewBox={`0 0 ${WORDMARK_WIDTH} ${WORDMARK_HEIGHT}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        x="0"
        y={WORDMARK_HEIGHT}
        fill="currentColor"
        fontFamily="var(--font-sans)"
        fontSize="100"
        fontWeight="600"
        letterSpacing="-2"
        lengthAdjust="spacing"
        textLength={WORDMARK_WIDTH}
      >
        Itô
      </text>
    </svg>
  );
}
