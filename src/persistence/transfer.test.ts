import { describe, expect, it } from "vitest";
import { createEmptyLevel, type LevelDoc } from "@/format/level";
import { makeBundle, parseBundle } from "./transfer";

const level = createEmptyLevel("a", "First");

describe("bundle round trip", () => {
  it("survives export -> JSON -> import unchanged", () => {
    const text = JSON.stringify(makeBundle([level, createEmptyLevel("b", "Second")]));
    const parsed = parseBundle(text);
    expect("levels" in parsed).toBe(true);
    if (!("levels" in parsed)) return;
    expect(parsed.levels).toHaveLength(2);
    expect(parsed.levels[0]).toEqual(level);
  });

  it("accepts a bare level document, not just a wrapped bundle", () => {
    // Someone will hand a friend a single exported level. Being pedantic about
    // the wrapper would reject a file that is obviously fine.
    const parsed = parseBundle(JSON.stringify(level));
    expect("levels" in parsed && parsed.levels).toHaveLength(1);
  });
});

describe("rejecting bad input", () => {
  it("explains itself instead of throwing", () => {
    // An imported file is untrusted input heading for the compiler. It must
    // fail with a sentence a person can act on, not blow up in the renderer.
    for (const bad of ["", "not json", "[]", "{}", '{"levels":[]}', "null", "42"]) {
      const parsed = parseBundle(bad);
      expect("error" in parsed, `should reject: ${bad}`).toBe(true);
      if ("error" in parsed) expect(parsed.error.length).toBeGreaterThan(10);
    }
  });

  it("rejects a level whose grid does not match its dimensions", () => {
    const corrupt = {
      ...level,
      areas: [{ ...level.areas[0], tiles: [1, 2, 3] }],
    };
    expect("error" in parseBundle(JSON.stringify(corrupt))).toBe(true);
  });

  it("refuses levels that need a newer reader", () => {
    const future: LevelDoc = { ...level, minReader: 999 };
    const parsed = parseBundle(JSON.stringify(makeBundle([future])));
    expect("error" in parsed && parsed.error).toMatch(/newer version/);
  });

  it("keeps the readable levels when only some are too new", () => {
    const future: LevelDoc = { ...createEmptyLevel("c"), minReader: 999 };
    const parsed = parseBundle(JSON.stringify(makeBundle([level, future])));
    expect("levels" in parsed && parsed.levels).toHaveLength(1);
  });

  it("skips entries that are not levels at all", () => {
    const mixed = { kind: "pixel-forge-levels", version: 1, levels: [level, null, 7, {}] };
    const parsed = parseBundle(JSON.stringify(mixed));
    expect("levels" in parsed && parsed.levels).toHaveLength(1);
  });
});
