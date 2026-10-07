import { describe, expect, it } from "vitest";
import { objectParts, tileParts } from "./parts";

// The palette chip is 56 px wide and its 9 px label wraps at spaces onto at most two lines, each
// clipping past about eight characters, so a longer name needs a `short` for the chip.
const CHIP_CHARS = 8;
const CHIP_LINES = 2;

const ALL = [...tileParts(), ...objectParts()].map((p) => [p.label, p] as const);

describe("palette chip labels", () => {
  it.each(ALL)("%s fits its chip", (_, part) => {
    const words = (part.short ?? part.label).split(" ");
    expect(words.length).toBeLessThanOrEqual(CHIP_LINES);
    for (const word of words) expect(word.length).toBeLessThanOrEqual(CHIP_CHARS);
  });

  // The chip's accessible name is the full label, so what it shows must be part of it (WCAG 2.5.3).
  it.each(ALL)("%s: the visible text is contained in the full label", (_, part) => {
    expect(part.label.toLowerCase()).toContain((part.short ?? part.label).toLowerCase());
  });

  it("a warp chip says it is a warp", () => {
    for (const part of objectParts().filter((p) => p.key.startsWith("pipe"))) {
      expect(part.short ?? part.label).toMatch(/warp/i);
    }
  });
});
