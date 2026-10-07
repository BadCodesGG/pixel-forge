import { describe, expect, it } from "vitest";
import { GLYPHS, GRID, glyphRuns, type IconName } from "./glyphs";

/**
 * Data validation for hand-drawn pixel art.
 *
 * A character grid has exactly one failure mode: a row with the wrong number of
 * characters. It does not throw, it does not fail to compile, and it does not
 * look obviously broken - the glyph just shifts by a pixel somewhere, which is
 * the kind of thing that survives review and gets noticed months later. These
 * tests are the guard.
 *
 * This file is deliberately .ts and touches no DOM, because vitest runs in the
 * `node` environment here and the include glob is src/**\/*.test.ts.
 */

const names = Object.keys(GLYPHS) as IconName[];

describe("icon glyphs", () => {
  it("has glyphs to check", () => {
    expect(names.length).toBeGreaterThan(20);
  });

  it.each(names)("%s is %d rows of %d characters", (name) => {
    const rows = GLYPHS[name];
    expect(rows).toHaveLength(GRID);
    for (let y = 0; y < rows.length; y++) {
      // Named in the message so a failure says WHICH row to go and fix.
      expect(`${name} row ${y}: ${rows[y]}`).toHaveLength(
        `${name} row ${y}: `.length + GRID,
      );
    }
  });

  it.each(names)("%s uses only legal characters", (name) => {
    for (const row of GLYPHS[name]) {
      expect(row).toMatch(/^[.xo]+$/);
    }
  });

  it.each(names)("%s is not blank", (name) => {
    const ink = GLYPHS[name].join("").replace(/\./g, "");
    expect(ink.length).toBeGreaterThan(8);
  });

  it("keeps every run inside the grid", () => {
    for (const name of names) {
      for (const run of glyphRuns(GLYPHS[name])) {
        expect(run.x).toBeGreaterThanOrEqual(0);
        expect(run.y).toBeGreaterThanOrEqual(0);
        expect(run.x + run.w).toBeLessThanOrEqual(GRID);
        expect(run.w).toBeGreaterThan(0);
      }
    }
  });

  it("merges runs rather than emitting one rect per pixel", () => {
    // stop is a solid 10x10 block: 100 pixels, but only 10 runs.
    expect(glyphRuns(GLYPHS.stop)).toHaveLength(10);
  });
});
