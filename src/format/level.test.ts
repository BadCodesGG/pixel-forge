import { describe, expect, it } from "vitest";
import {
  PART_SPAN,
  cellPart,
  cellVariant,
  contentHash,
  createEmptyLevel,
  makeCell,
  MARKER_GOAL,
  MARKER_START,
  type LevelDoc,
} from "./level";
import { PARTS, palettableParts, partById, partByKey } from "./parts";

describe("tile cell packing", () => {
  it("round-trips part and variant", () => {
    for (const part of [0, 1, 8, 4095]) {
      for (const variant of [0, 1, 7, 15]) {
        const cell = makeCell(part, variant);
        expect(cellPart(cell)).toBe(part);
        expect(cellVariant(cell)).toBe(variant);
      }
    }
  });

  it("keeps the variant through a save, which is the whole reason it is packed", () => {
    // The bug this guards: the author fixes an ugly autotiled corner, shares
    // the level, and the recipient sees the ugly corner again because the
    // override was dropped somewhere in serialization.
    const cell = makeCell(3, 5);
    const roundTripped = JSON.parse(JSON.stringify({ cell })).cell;
    expect(cellPart(roundTripped)).toBe(3);
    expect(cellVariant(roundTripped)).toBe(5);
  });

  it("reserves 0 for empty so a zeroed grid means an empty level", () => {
    expect(cellPart(0)).toBe(0);
    expect(PARTS.every((p) => p.id !== 0)).toBe(true);
  });

  it("fits every part id inside the packed span", () => {
    for (const part of PARTS) expect(part.id).toBeLessThan(PART_SPAN);
  });
});

describe("part registry", () => {
  it("has unique ids and keys", () => {
    expect(new Set(PARTS.map((p) => p.id)).size).toBe(PARTS.length);
    expect(new Set(PARTS.map((p) => p.key)).size).toBe(PARTS.length);
  });

  it("looks parts up both ways", () => {
    for (const part of PARTS) {
      expect(partById(part.id)).toBe(part);
      expect(partByKey(part.key)).toBe(part);
    }
    expect(partById(9999)).toBeUndefined();
  });

  it("hides retired parts from the palette but keeps their ids resolvable", () => {
    // Retiring must never free an id for reuse: a saved level still refers to
    // it, and handing the number to a different part silently rewrites levels.
    for (const part of palettableParts()) expect(part.retired).toBeFalsy();
  });
});

describe("new level template", () => {
  it("is never a blank grid", () => {
    // A blank canvas gives a young player nothing to react to. A floor with a start
    // and a finish is immediately a (very short) game they can press play on.
    const doc = createEmptyLevel("abc");
    const area = doc.areas[0];
    expect(area.tiles.some((c) => c !== 0)).toBe(true);
    expect(area.objects.map((o) => o.part)).toContain(MARKER_START);
    expect(area.objects.map((o) => o.part)).toContain(MARKER_GOAL);
  });

  it("sizes the grid to match its declared dimensions", () => {
    const area = createEmptyLevel("abc").areas[0];
    expect(area.tiles.length).toBe(area.w * area.h);
  });
});

describe("contentHash", () => {
  const base = createEmptyLevel("id-1", "First");

  it("ignores identity and naming", () => {
    // Two levels with the same geometry hash the same however they are named
    // or whenever they were saved. That is what makes "has this actually
    // changed since it was verified?" an answerable question.
    const renamed: LevelDoc = { ...base, id: "id-2", title: "Totally different" };
    expect(contentHash(renamed)).toBe(contentHash(base));
  });

  it("changes when a single tile changes", () => {
    const tiles = [...base.areas[0].tiles];
    tiles[0] = makeCell(2);
    const edited: LevelDoc = { ...base, areas: [{ ...base.areas[0], tiles }] };
    expect(contentHash(edited)).not.toBe(contentHash(base));
  });

  it("changes when a marker moves", () => {
    const objects = base.areas[0].objects.map((o) =>
      o.part === MARKER_GOAL ? { ...o, tx: o.tx + 1 } : o,
    );
    const moved: LevelDoc = { ...base, areas: [{ ...base.areas[0], objects }] };
    expect(contentHash(moved)).not.toBe(contentHash(base));
  });

  it("is stable across a JSON round trip", () => {
    const copy: LevelDoc = JSON.parse(JSON.stringify(base));
    expect(contentHash(copy)).toBe(contentHash(base));
  });
});
