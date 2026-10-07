import { describe, expect, it } from "vitest";
import { ADVANCE, GLYPHS, GLYPH_H, GLYPH_W, textWidth } from "./font";

/**
 * Data validation for the hand-drawn bitmap face.
 *
 * A grid with a mistyped row does not throw and does not fail to compile - the
 * glyph just shifts by a pixel. These tests are the only thing that catches it.
 *
 * Deliberately touches no DOM: vitest runs in the `node` environment here, so
 * anything that reached for `document` would fail. Only the data is checked.
 */

const names = Object.keys(GLYPHS);

describe("bitmap font", () => {
  it("covers digits, the whole alphabet and the symbols the HUD uses", () => {
    for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ :+-!./") {
      expect(GLYPHS[ch], `missing glyph for "${ch}"`).toBeDefined();
    }
  });

  it.each(names)('glyph "%s" is the right shape', (ch) => {
    const rows = GLYPHS[ch];
    expect(rows).toHaveLength(GLYPH_H);
    for (let y = 0; y < rows.length; y++) {
      expect(`${ch}${y}:${rows[y]}`).toHaveLength(`${ch}${y}:`.length + GLYPH_W);
      expect(rows[y]).toMatch(/^[.#]+$/);
    }
  });

  it("draws every glyph except space with some ink", () => {
    for (const ch of names) {
      if (ch === " ") continue;
      const ink = GLYPHS[ch].join("").replace(/\./g, "");
      expect(ink.length, `"${ch}" is blank`).toBeGreaterThan(0);
    }
  });

  it("measures a string as cells plus tracking", () => {
    expect(textWidth("A")).toBe(GLYPH_W);
    expect(textWidth("AB")).toBe(ADVANCE + GLYPH_W);
    expect(textWidth("", 2)).toBe(0);
    expect(textWidth("AB", 2)).toBe((ADVANCE + GLYPH_W) * 2);
  });
});
