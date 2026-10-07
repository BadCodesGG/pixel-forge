import { describe, expect, it } from "vitest";
import { Button, type ButtonId } from "@/engine/core/input";
import { KEY_BINDINGS } from "@/host/input";
import { GLYPHS } from "./ui/glyphs";
import { MOVES, hintFor, schemeFor, type Scheme } from "./controls";

/**
 * THE GUIDE CANNOT LIE ABOUT THE CONTROLS.
 *
 * This is the regression guard for a bug that shipped: the play chrome printed
 * "ARROWS MOVE - SPACE JUMP - R AGAIN" as a literal, with nothing tying it to
 * the real bindings. Rebinding a key would have left it silently wrong, and
 * nothing in lint, types or the existing tests could have noticed.
 *
 * ASCII is asserted because non-ASCII in this repo's source has been mangled by
 * shell round-trips more than once - see CONTRIBUTING.md. A guide rendered as mojibake
 * is worse than no guide.
 */

const ASCII = /^[\x20-\x7e]+$/;
const SCHEMES: Scheme[] = ["touch", "keys", "pad"];

/** Every code the real bindings map to a given button. */
function codesFor(button: ButtonId): string[] {
  return Object.keys(KEY_BINDINGS).filter((code) => KEY_BINDINGS[code] === button);
}

describe("the move list", () => {
  it("documents something", () => {
    expect(MOVES.length).toBeGreaterThan(4);
  });

  it.each(MOVES)("$label names a key that really does it", (move) => {
    for (const code of move.codes) {
      expect(KEY_BINDINGS[code], `${move.label} claims ${code}`).toBe(move.button);
    }
  });

  it.each(MOVES.filter((m) => m.button !== null))("$label backs its claim with a code", (move) => {
    // A row about an engine button with no codes could not be checked at all,
    // which would quietly opt it out of the assertion above.
    expect(move.codes.length).toBeGreaterThan(0);
  });

  it("documents every way to jump", () => {
    // The one a stuck player is looking for. If someone adds a jump key and
    // forgets the guide, this is what says so.
    const jump = MOVES.find((m) => m.button === Button.A);
    expect(jump).toBeDefined();
    expect([...(jump?.codes ?? [])].sort()).toEqual(codesFor(Button.A).sort());
  });

  it("documents every way to run", () => {
    const run = MOVES.find((m) => m.button === Button.B);
    expect(run).toBeDefined();
    expect([...(run?.codes ?? [])].sort()).toEqual(codesFor(Button.B).sort());
  });

  it.each(MOVES)("$label tells all three kinds of player what to do", (move) => {
    expect(move.touch.length).toBeGreaterThan(0);
    expect(move.pad.length).toBeGreaterThan(0);
    expect(move.keys.length).toBeGreaterThan(0);
  });

  it.each(MOVES)("$label leads with a glyph that exists", (move) => {
    expect(GLYPHS[move.icon]).toBeDefined();
  });

  it.each(MOVES)("$label is plain ASCII throughout", (move) => {
    for (const text of [move.label, move.touch, move.pad, ...move.keys]) {
      expect(text).toMatch(ASCII);
    }
    if (move.note) expect(move.note).toMatch(ASCII);
  });

  it("never tells a touch player to press a key", () => {
    // The original bug, as a property. The touch column is read by someone
    // holding a slab of glass with no keyboard anywhere near it.
    //
    // Only unambiguous giveaways are listed. "Tap the arrow button" is about an
    // on-screen icon and is fine, and DUCK legitimately says "push down" - so
    // matching every key NAME would fail on correct copy and get deleted, which
    // is worse than a narrower check that survives.
    for (const move of MOVES) {
      expect(move.touch.toUpperCase(), move.label).not.toMatch(
        /\b(SPACEBAR|SPACE BAR|KEY|KEYS|KEYBOARD|ARROW KEYS?)\b/,
      );
      expect(move.touch.toUpperCase(), move.label).not.toContain("PRESS SPACE");
    }
  });
});

describe("hintFor", () => {
  it.each(SCHEMES)("%s gets a non-empty ASCII hint", (scheme) => {
    expect(hintFor(scheme)).toMatch(ASCII);
  });

  it("says something different to each kind of player", () => {
    expect(new Set(SCHEMES.map(hintFor)).size).toBe(SCHEMES.length);
  });

  it("does not name a key in the touch hint", () => {
    expect(hintFor("touch").toUpperCase()).not.toContain("SPACE");
    expect(hintFor("touch").toUpperCase()).not.toContain("ARROWS");
  });
});

describe("schemeFor", () => {
  it("prefers the gamepad once one has been used", () => {
    expect(schemeFor(true, true)).toBe("pad");
    expect(schemeFor(false, true)).toBe("pad");
  });

  it("opens on touch for a tablet", () => {
    expect(schemeFor(true, false)).toBe("touch");
  });

  it("falls back to keys", () => {
    expect(schemeFor(false, false)).toBe("keys");
  });
});
