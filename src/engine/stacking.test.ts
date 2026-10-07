import { describe, expect, it } from "vitest";
import { compileArea } from "./level/compile";
import { createEmptyLevel, makeCell } from "@/format/level";
import { partByKey } from "@/format/parts";
import { Sim } from "./sim";
import type { AreaDoc, LevelDoc, ObjectDoc } from "@/format/level";

/**
 * Stacked enemies.
 *
 * Two things have to be true for a stack to be a real thing an author can
 * build: they must spawn as a pile rather than inside each other, and the pile
 * must HOLD - entities used to pass straight through one another, so a
 * deliberate stack collapsed into a single square on the first frame.
 */

const GROUND = partByKey("ground")!.id;
const FLOOR_TY = 22;

function levelWith(objects: { part: string; tx: number; ty: number }[]): LevelDoc {
  const base = createEmptyLevel("stack-test");
  const area = base.areas[0];
  const tiles = new Uint16Array(area.tiles);
  for (let tx = 0; tx < area.w; tx++) tiles[FLOOR_TY * area.w + tx] = makeCell(GROUND, 0);

  const objs: ObjectDoc[] = objects.map((o, i) => ({ id: 200 + i, part: o.part, tx: o.tx, ty: o.ty }));
  const nextArea: AreaDoc = {
    ...area,
    tiles: Array.from(tiles),
    objects: [...area.objects, ...objs],
  };
  return { ...base, areas: [nextArea] };
}

/** Run far enough for gravity to settle everything. */
function settle(sim: Sim, frames = 90) {
  for (let i = 0; i < frames; i++) sim.step();
}

function activeEntities(sim: Sim) {
  const out: { kind: number; x: number; y: number }[] = [];
  const s = sim.world.store;
  for (let i = 0; i < s.capacity; i++) {
    if (!sim.world.isActive(i)) continue;
    out.push({ kind: s.kind[i], x: s.x[i], y: s.y[i] });
  }
  return out.sort((a, b) => a.y - b.y);
}

describe("stacked enemies", () => {
  it("compiles a shared cell into an ordered stack", () => {
    const doc = levelWith([
      { part: "shellWalker", tx: 4, ty: 21 },
      { part: "walker", tx: 4, ty: 21 },
    ]);
    const spawns = compileArea(doc.areas[0]).spawns.filter((s) => s.tx === 4);
    expect(spawns.map((s) => s.stack)).toEqual([0, 1]);
  });

  it("keeps one enemy standing on the other instead of merging", () => {
    const doc = levelWith([
      { part: "shellWalker", tx: 4, ty: 21 },
      { part: "walker", tx: 4, ty: 21 },
    ]);
    const sim = new Sim(compileArea(doc.areas[0]));
    settle(sim);

    const live = activeEntities(sim);
    expect(live).toHaveLength(2);

    const [upper, lower] = live;
    // Genuinely one above the other, not two things in the same square.
    expect(lower.y - upper.y).toBeGreaterThan(8 * 4096);
    // And the top one is the one that was placed second.
    expect(upper.kind).toBe(partByKey("walker")!.id);
  });

  it("leaves a lone enemy exactly where it was before stacking existed", () => {
    const doc = levelWith([{ part: "walker", tx: 4, ty: 21 }]);
    const sim = new Sim(compileArea(doc.areas[0]));
    settle(sim);

    const live = activeEntities(sim);
    expect(live).toHaveLength(1);
    // Standing on the floor, which is the top of row FLOOR_TY.
    const feetTiles = live[0].y / 65536;
    expect(feetTiles).toBeGreaterThan(FLOOR_TY - 2);
    expect(feetTiles).toBeLessThan(FLOOR_TY);
  });
});
