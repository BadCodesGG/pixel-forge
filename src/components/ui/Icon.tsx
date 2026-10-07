import type { CSSProperties } from "react";
import { GLYPHS, GRID, glyphRuns, type GlyphRun, type IconName } from "./glyphs";

export type { IconName };

/**
 * A pixel glyph, drawn as hard rectangles on a 16x16 grid.
 *
 * The art itself lives in ./glyphs.ts as readable character grids - see the
 * note at the top of that file for why, and for the size rule.
 *
 * shapeRendering="crispEdges" on the <svg> is inherited by every rect and is
 * what keeps the edges hard at any scale. There is no stroke anywhere: a
 * stroked path antialiases, and an antialiased pixel is not a pixel.
 */

const runCache = new Map<IconName, GlyphRun[]>();

function runsFor(name: IconName): GlyphRun[] {
  let runs = runCache.get(name);
  if (!runs) {
    runs = glyphRuns(GLYPHS[name]);
    runCache.set(name, runs);
  }
  return runs;
}

export function Icon(props: {
  name: IconName;
  /** MUST be a multiple of 16. Defaults to 16. See glyphs.ts. */
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const size = props.size ?? GRID;

  if (process.env.NODE_ENV !== "production" && size % GRID !== 0) {
    // Not an exception, because a slightly-wrong icon should not take the app
    // down - but this degrades silently and invisibly, so it has to say so.
    console.warn(
      `Icon "${props.name}" rendered at ${size}px. Glyphs are ${GRID} units wide, so a ` +
        `non-multiple makes some glyph pixels wider than others. Use SIZE.iconSmall/iconLarge.`,
    );
  }

  const runs = runsFor(props.name);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${GRID} ${GRID}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      className={props.className}
      style={props.style}
      aria-hidden="true"
      focusable="false"
    >
      {runs.map((run, i) => (
        <rect
          key={i}
          x={run.x}
          y={run.y}
          width={run.w}
          height={1}
          // The second tone. Opacity rather than a second colour, so one glyph
          // works on every tone of button without knowing which it is on.
          opacity={run.soft ? 0.5 : undefined}
        />
      ))}
    </svg>
  );
}
