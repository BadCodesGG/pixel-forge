import { describe, expect, it } from "vitest";
import { fromPx, toPxFloat, type Fixed } from "../math/fixed";
import { Button, makeInput, type ButtonId } from "../core/input";
import { MAX_ENTITIES } from "../core/constants";
import { createEmptyLevel, makeCell, type LevelDoc } from "@/format/level";
import { Sim } from "../sim";
import { EntityState, SHELL_PART } from "../entities/defs";

/**
 * Entity tests run through the whole Sim rather than poking systems directly,
 * because the interesting bugs live in the ORDER things happen: streaming
 * before behaviour, behaviour before the player, the player before collisions.
 */

const px = (v: number) => toPxFloat(v as Fixed);
const hold = (...b: ButtonId[]) => makeInput(b, []);
const press = (...b: ButtonId[]) => makeInput(b, b);

/** A level with a flat floor and whatever objects the test needs. */
function level(objects: { part: string; tx: number; ty: number }[]): LevelDoc {
  const base = createEmptyLevel("t");
  const area = base.areas[0];
  const tiles = [...area.tiles];
  const floorTop = area.h - 5;
  // Solid ground everywhere so nothing falls into a pit mid-test.
  for (let ty = floorTop; ty < area.h; ty++) {
    for (let tx = 0; tx < area.w; tx++) tiles[ty * area.w + tx] = makeCell(1);
  }
  return {
    ...base,
    areas: [
      {
        ...area,
        tiles,
        objects: [
          { id: 1, part: "startMarker", tx: 3, ty: floorTop - 1 },
          { id: 2, part: "goalPole", tx: 100, ty: floorTop - 1 },
          ...objects.map((o, i) => ({ id: 10 + i, ...o })),
        ],
      },
    ],
  };
}

const FLOOR_TOP = createEmptyLevel("t").areas[0].h - 5;

function countLive(sim: Sim): number {
  let n = 0;
  for (let i = 0; i < MAX_ENTITIES; i++) if (sim.world.isActive(i)) n++;
  return n;
}

function firstLive(sim: Sim): number {
  for (let i = 0; i < MAX_ENTITIES; i++) if (sim.world.isActive(i)) return i;
  return -1;
}

describe("streaming", () => {
  it("spawns objects near the camera and not the whole level at once", () => {
    const sim = Sim.fromDoc(
      level([
        { part: "walker", tx: 8, ty: FLOOR_TOP - 1 },
        { part: "walker", tx: 100, ty: FLOOR_TOP - 1 }, // far off-screen
      ]),
    );
    sim.step();
    expect(countLive(sim)).toBe(1);
  });

  it("never spawns the same object twice while it is alive", () => {
    const sim = Sim.fromDoc(level([{ part: "coin", tx: 8, ty: FLOOR_TOP - 3 }]));
    for (let i = 0; i < 120; i++) sim.step();
    expect(countLive(sim)).toBe(1);
  });

  it("retires entities the camera has left far behind", () => {
    const sim = Sim.fromDoc(level([{ part: "walker", tx: 6, ty: FLOOR_TOP - 1 }]));
    sim.step();
    expect(countLive(sim)).toBe(1);
    // Run right until the walker is well behind the camera.
    for (let i = 0; i < 600; i++) sim.step(hold(Button.RIGHT, Button.B));
    const stillNearStart = px(sim.player.x) < 200;
    if (!stillNearStart) expect(countLive(sim)).toBe(0);
  });
});

describe("walking behaviour", () => {
  it("walks and turns around at a wall", () => {
    const doc = level([{ part: "walker", tx: 8, ty: FLOOR_TOP - 1 }]);
    const area = doc.areas[0];
    const tiles = [...area.tiles];
    // A wall two tiles to its left.
    for (let ty = FLOOR_TOP - 3; ty < FLOOR_TOP; ty++) tiles[ty * area.w + 6] = makeCell(1);
    const sim = Sim.fromDoc({ ...doc, areas: [{ ...area, tiles }] });

    sim.step();
    const i = firstLive(sim);
    const startFace = sim.world.store.face[i];
    for (let t = 0; t < 200; t++) sim.step();
    // It began facing left; hitting the wall must have flipped it.
    expect(sim.world.store.face[firstLive(sim)]).not.toBe(startFace);
  });

  it("a careful walker turns at a ledge instead of falling off it", () => {
    const doc = level([{ part: "shellWalker", tx: 8, ty: FLOOR_TOP - 1 }]);
    const area = doc.areas[0];
    const tiles = [...area.tiles];
    // Punch a hole to its left; it must not walk into it.
    for (let ty = FLOOR_TOP; ty < area.h; ty++) {
      for (let tx = 3; tx <= 5; tx++) tiles[ty * area.w + tx] = 0;
    }
    const sim = Sim.fromDoc({ ...doc, areas: [{ ...area, tiles }] });

    for (let t = 0; t < 400; t++) sim.step();
    const i = firstLive(sim);
    expect(i).toBeGreaterThanOrEqual(0);
    // Still on the floor, not in the pit.
    expect(px(sim.world.store.y[i])).toBeLessThan((FLOOR_TOP + 2) * 16);
  });
});

describe("stomping", () => {
  /** Drop the player onto an enemy placed just below. */
  function stompSetup() {
    const sim = Sim.fromDoc(level([{ part: "walker", tx: 4, ty: FLOOR_TOP - 1 }]));
    sim.step();
    // Put the player directly above the walker, falling.
    sim.player.x = fromPx(4 * 16 + 8);
    sim.player.y = fromPx((FLOOR_TOP - 1) * 16 - 20);
    sim.player.vy = fromPx(4);
    return sim;
  }

  it("defeats the enemy and bounces the player", () => {
    const sim = stompSetup();
    let bounced = false;
    for (let t = 0; t < 30; t++) {
      sim.step(hold(Button.A));
      if (sim.player.vy < 0) bounced = true;
      if (bounced) break;
    }
    expect(bounced).toBe(true);
    expect(sim.score).toBeGreaterThan(0);
  });

  it("freezes the world briefly on impact", () => {
    // Hitstop is what makes a stomp feel like it connects. A purely visual
    // wobble does not read as impact.
    const sim = stompSetup();
    let sawHitstop = false;
    for (let t = 0; t < 30; t++) {
      sim.step(hold(Button.A));
      if (sim.hitstop > 0) sawHitstop = true;
    }
    expect(sawHitstop).toBe(true);
  });

  it("escalates the score for each enemy in a chain", () => {
    const sim = Sim.fromDoc(
      level([
        { part: "walker", tx: 4, ty: FLOOR_TOP - 1 },
        { part: "walker", tx: 6, ty: FLOOR_TOP - 1 },
      ]),
    );
    sim.step();
    const scores: number[] = [];
    // Stomp twice without landing by teleporting onto each in turn.
    for (const tx of [4, 6]) {
      sim.player.x = fromPx(tx * 16 + 8);
      sim.player.y = fromPx((FLOOR_TOP - 1) * 16 - 20);
      sim.player.vy = fromPx(4);
      sim.player.grounded = false;
      const before = sim.score;
      for (let t = 0; t < 20; t++) {
        sim.step(hold(Button.A));
        if (sim.score > before) break;
      }
      scores.push(sim.score - before);
    }
    // 100 then 200: the chain is one of the most satisfying mechanics and
    // costs one array plus a counter.
    expect(scores[1]).toBeGreaterThan(scores[0]);
  });

  it("turns a shell walker into a shell instead of defeating it", () => {
    const sim = Sim.fromDoc(level([{ part: "shellWalker", tx: 4, ty: FLOOR_TOP - 1 }]));
    sim.step();
    sim.player.x = fromPx(4 * 16 + 8);
    sim.player.y = fromPx((FLOOR_TOP - 1) * 16 - 20);
    sim.player.vy = fromPx(4);
    for (let t = 0; t < 30; t++) {
      sim.step(hold(Button.A));
      const i = firstLive(sim);
      if (i >= 0 && sim.world.store.kind[i] === SHELL_PART) break;
    }
    const i = firstLive(sim);
    expect(sim.world.store.kind[i]).toBe(SHELL_PART);
    expect(sim.world.store.state[i]).toBe(EntityState.DORMANT);
  });
});

describe("collectibles", () => {
  it("collects a coin and counts it once", () => {
    const sim = Sim.fromDoc(level([{ part: "coin", tx: 4, ty: FLOOR_TOP - 1 }]));
    sim.step();
    sim.player.x = fromPx(4 * 16 + 8);
    sim.player.y = fromPx((FLOOR_TOP - 1) * 16);
    for (let t = 0; t < 10; t++) sim.step();
    expect(sim.coins).toBe(1);
    expect(countLive(sim)).toBe(0);
    // Standing where it was must not keep scoring.
    for (let t = 0; t < 30; t++) sim.step();
    expect(sim.coins).toBe(1);
  });

  it("grows the player and keeps their feet on the ground", () => {
    // Growing expands the hitbox. Expanding around the CENTRE pushes the feet
    // into the floor, where the crush rule lives.
    const sim = Sim.fromDoc(level([{ part: "growCap", tx: 4, ty: FLOOR_TOP - 1 }]));
    sim.step();
    sim.player.x = fromPx(4 * 16 + 8);
    sim.player.y = fromPx((FLOOR_TOP - 1) * 16);
    for (let t = 0; t < 20; t++) sim.step();

    expect(sim.player.powerTier).toBe(1);
    const feet = px(sim.player.y + sim.player.halfH);
    expect(feet).toBeLessThanOrEqual(FLOOR_TOP * 16 + 1);
  });
});

describe("damage", () => {
  it("costs a power tier rather than a life when big", () => {
    const sim = Sim.fromDoc(level([{ part: "walker", tx: 8, ty: FLOOR_TOP - 1 }]));
    sim.step();
    sim.player.powerTier = 1;
    const deathsBefore = sim.deaths;

    // Walk into it from the side.
    for (let t = 0; t < 400 && sim.player.powerTier === 1; t++) {
      sim.step(hold(Button.RIGHT));
    }
    expect(sim.player.powerTier).toBe(0);
    expect(sim.deaths).toBe(deathsBefore);
    expect(sim.player.iFrames).toBeGreaterThan(0);
  });

  it("does not take a second hit during invulnerability", () => {
    const sim = Sim.fromDoc(level([{ part: "walker", tx: 8, ty: FLOOR_TOP - 1 }]));
    sim.step();
    sim.player.powerTier = 1;
    for (let t = 0; t < 400 && sim.player.iFrames === 0; t++) sim.step(hold(Button.RIGHT));
    const deaths = sim.deaths;
    // Keep standing in the enemy while the i-frames run.
    for (let t = 0; t < 60; t++) sim.step(hold(Button.RIGHT));
    expect(sim.deaths).toBe(deaths);
  });

  it("respawns after walking into spikes while small", () => {
    const doc = level([]);
    const area = doc.areas[0];
    const tiles = [...area.tiles];
    tiles[(FLOOR_TOP - 1) * area.w + 8] = makeCell(8); // spikes
    const sim = Sim.fromDoc({ ...doc, areas: [{ ...area, tiles }] });
    const spawnX = sim.player.x;

    for (let t = 0; t < 400 && sim.deaths === 0; t++) sim.step(hold(Button.RIGHT));
    expect(sim.deaths).toBe(1);
    expect(sim.player.x).toBe(spawnX);
  });
});

describe("the clock", () => {
  it("counts down one unit per real second", () => {
    // One unit is one real second, deliberately not a faster-than-real
    // tick. A clock that lies is a clock that feels unfair.
    const sim = Sim.fromDoc({ ...level([]), timeLimit: 10 });
    expect(sim.timeLeft).toBe(10);
    for (let i = 0; i < 60; i++) sim.step();
    expect(sim.timeLeft).toBe(9);
    for (let i = 0; i < 120; i++) sim.step();
    expect(sim.timeLeft).toBe(7);
  });

  it("kills the player when it reaches zero, whatever their power tier", () => {
    const sim = Sim.fromDoc({ ...level([]), timeLimit: 1 });
    sim.player.powerTier = 1; // being big must not save you from the clock
    for (let i = 0; i < 130 && sim.deaths === 0; i++) sim.step();
    expect(sim.deaths).toBe(1);
    expect(sim.timeLeft).toBe(1); // reset to full on respawn
  });

  it("warns once, not every tick, when time is nearly up", () => {
    const sim = Sim.fromDoc({ ...level([]), timeLimit: 31 });
    let warnings = 0;
    for (let i = 0; i < 60 * 5; i++) {
      sim.step();
      warnings += sim.events.filter((e) => e.kind === "timeWarning").length;
    }
    expect(warnings).toBe(1);
  });

  it("leaves an untimed level alone", () => {
    const sim = Sim.fromDoc({ ...level([]), timeLimit: 0 });
    for (let i = 0; i < 400; i++) sim.step();
    expect(sim.deaths).toBe(0);
    expect(sim.timeLeft).toBe(0);
  });
});

describe("determinism with entities", () => {
  it("produces identical state from identical input", () => {
    const doc = level([
      { part: "walker", tx: 8, ty: FLOOR_TOP - 1 },
      { part: "coin", tx: 10, ty: FLOOR_TOP - 3 },
      { part: "shellWalker", tx: 14, ty: FLOOR_TOP - 1 },
    ]);
    const play = () => {
      const sim = Sim.fromDoc(doc);
      for (let i = 0; i < 500; i++) {
        const keys: ButtonId[] = [Button.RIGHT];
        if (i % 23 === 0) keys.push(Button.A);
        sim.step(i % 23 === 0 ? press(...keys) : hold(...keys));
      }
      return {
        x: sim.player.x,
        y: sim.player.y,
        coins: sim.coins,
        score: sim.score,
        deaths: sim.deaths,
        live: countLive(sim),
      };
    };
    expect(play()).toEqual(play());
  });
});
