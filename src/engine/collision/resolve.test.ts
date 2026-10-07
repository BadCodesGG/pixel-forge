import { describe, expect, it } from "vitest";
import { fromPx, toPxFloat, type Fixed } from "../math/fixed";
import { TileFlags } from "../core/flags";
import { Tilemap } from "./tilemap";
import { Shape } from "./tileShapes";
import { moveActor, overlapsSolid, type Actor, type MoveResult } from "./resolve";

const GROUND = TileFlags.SOLID | TileFlags.SCROLL_STOP;
const SEMISOLID = TileFlags.ONE_WAY;

/** Typical falling gravity (0.4375 px/frame^2) and terminal speed (4.5 px/frame). */
const GRAVITY = fromPx(0.4375);
const TERMINAL = fromPx(4.5);

const px = (v: Fixed) => toPxFloat(v);

/** A 12x24 px actor, about the size of a "super" player. */
function actor(xPx: number, yPx: number, over: Partial<Actor> = {}): Actor {
  return {
    x: fromPx(xPx),
    y: fromPx(yPx),
    vx: 0 as Fixed,
    vy: 0 as Fixed,
    halfW: fromPx(6),
    halfH: fromPx(12),
    prevBottom: fromPx(yPx + 12),
    ...over,
  };
}

/**
 * One simulation tick, the way the physics system will drive it: latch the
 * previous bottom edge, apply gravity, then resolve.
 *
 * Collision resolves a single tick's velocity; it does not run a fall to
 * completion, so anything testing landing, walls or slopes has to step.
 */
function tick(map: Tilemap, a: Actor, vx: Fixed = 0 as Fixed): MoveResult {
  a.prevBottom = (a.y + a.halfH) as Fixed;
  a.vx = vx;
  const next = (a.vy + GRAVITY) as Fixed;
  a.vy = (next > TERMINAL ? TERMINAL : next) as Fixed;
  const r = moveActor(map, a);
  a.wasGrounded = r.grounded;
  return r;
}

function run(map: Tilemap, a: Actor, ticks: number, vx: Fixed = 0 as Fixed): MoveResult {
  let last = tick(map, a, vx);
  for (let i = 1; i < ticks; i++) last = tick(map, a, vx);
  return last;
}

/** A flat floor across the bottom of a small room. Floor surface is y=192. */
function flatRoom(): Tilemap {
  const map = new Tilemap(20, 15);
  map.fill(0, 12, 19, 14, Shape.FULL, GROUND);
  return map;
}

describe("flat ground", () => {
  it("falls until it lands, then reports grounded", () => {
    const map = flatRoom();
    const a = actor(80, 150);
    const r = run(map, a, 30);
    expect(r.grounded).toBe(true);
    // Floor top is y=192; a 24px-tall actor rests with its centre 12px above.
    expect(px(a.y)).toBe(180);
    expect(a.vy).toBe(0);
  });

  it("does not stick or judder while running flush along the floor", () => {
    // The classic off-by-one: a box resting exactly on a tile boundary claims
    // to overlap the row below and gets pushed out of a tile it was never in.
    const map = flatRoom();
    const a = actor(40, 180);
    for (let i = 0; i < 60; i++) {
      const r = tick(map, a, fromPx(2.5));
      expect(r.grounded).toBe(true);
      expect(px(a.y)).toBe(180); // never nudged vertically
      expect(r.hitWallRight).toBe(false);
    }
    expect(px(a.x)).toBeCloseTo(40 + 2.5 * 60, 5);
  });

  it("stops against a wall and keeps standing", () => {
    const map = flatRoom();
    map.fill(10, 9, 10, 11, Shape.FULL, GROUND); // 3-tall wall at column 10
    const a = actor(100, 180);
    const r = run(map, a, 40, fromPx(2.5));
    expect(r.hitWallRight).toBe(true);
    expect(px(a.x)).toBe(160 - 6); // flush against the wall's left face
    expect(a.vx).toBe(0);
    expect(r.grounded).toBe(true); // still standing, not launched
  });

  it("stops against a ceiling without passing through", () => {
    const map = flatRoom();
    map.fill(0, 6, 19, 6, Shape.FULL, GROUND); // ceiling occupies y=96..112
    const a = actor(80, 150, { vy: fromPx(-6) });
    let hit = false;
    for (let i = 0; i < 10 && !hit; i++) {
      a.prevBottom = (a.y + a.halfH) as Fixed;
      const r = moveActor(map, a);
      hit = r.hitCeiling;
      if (!hit) a.vy = (a.vy + GRAVITY) as Fixed;
    }
    expect(hit).toBe(true);
    expect(px(a.y)).toBe(112 + 12); // just below the ceiling tile's bottom
    expect(a.vy).toBe(0);
  });
});

describe("high-speed movement", () => {
  it("cannot tunnel through a thin wall", () => {
    // 40 px/frame is far past anything the physics produces, but springs and
    // pipe ejection can approach it. Sub-stepping is what makes this safe.
    const map = flatRoom();
    map.fill(10, 9, 10, 11, Shape.FULL, GROUND); // wall's left face is x=160
    const a = actor(130, 180); // right edge at 136, 24px of clearance
    const r = tick(map, a, fromPx(40)); // one tick would carry it 40px, past the wall
    expect(r.hitWallRight).toBe(true);
    expect(px(a.x)).toBe(154);
    expect(overlapsSolid(map, a.x, a.y, a.halfW, a.halfH)).toBe(false);
  });

  it("cannot tunnel through the floor when falling fast", () => {
    const map = flatRoom();
    const a = actor(80, 140, { vy: fromPx(60) }); // bottom 152, floor at 192
    a.prevBottom = (a.y + a.halfH) as Fixed;
    const r = moveActor(map, a);
    expect(r.grounded).toBe(true);
    expect(px(a.y)).toBe(180);
  });
});

describe("semisolid platforms", () => {
  // Platform surface is the top of row 8, i.e. y=128.
  const semisolidRoom = () => {
    const map = flatRoom();
    map.fill(6, 8, 12, 8, Shape.EMPTY, SEMISOLID);
    return map;
  };

  it("lands on top when falling from above", () => {
    const map = semisolidRoom();
    const a = actor(160, 100);
    const r = run(map, a, 12);
    expect(r.grounded).toBe(true);
    expect(px(a.y)).toBe(128 - 12);
  });

  it("passes upward through it when jumping from below", () => {
    const map = semisolidRoom();
    // -8 px/frame against 0.4375 gravity peaks ~73px up, comfortably clearing
    // the 44px from the starting bottom edge (172) to the surface (128).
    const a = actor(160, 160, { vy: fromPx(-8) });
    for (let i = 0; i < 16; i++) {
      a.prevBottom = (a.y + a.halfH) as Fixed;
      const r = moveActor(map, a);
      expect(r.hitCeiling).toBe(false);
      expect(r.grounded).toBe(false);
      a.vy = (a.vy + GRAVITY) as Fixed;
    }
    // It should now be entirely above the platform surface at y=128.
    expect(px(a.y) + 12).toBeLessThan(128);
  });

  it("does not teleport you on top when you walk into its side", () => {
    // Testing only the current position (instead of prevBottom) causes exactly
    // this bug, and it is the single most common semisolid mistake.
    const map = semisolidRoom();
    const a = actor(80, 130); // bottom at 142, below the 128 surface
    for (let i = 0; i < 20; i++) {
      const r = tick(map, a, fromPx(3));
      expect(r.onSlope).toBe(false);
      // It may land on the real floor far below, but never on the platform.
      if (r.grounded) expect(px(a.y)).toBe(180);
    }
  });

  it("drops through when asked", () => {
    const map = semisolidRoom();
    const a = actor(160, 100, { dropThrough: true });
    run(map, a, 12);
    // Falls straight past the platform and lands on the real floor instead.
    expect(px(a.y) + 12).toBeGreaterThan(128);
  });
});

describe("slopes", () => {
  /**
   * A 1:1 slope climbing rightward across columns 5..8, flat ground either
   * side. The lower floor surface is y=192; the upper ledge is y=128.
   */
  function steepSlopeRoom(): Tilemap {
    const map = new Tilemap(20, 15);
    map.fill(0, 12, 19, 14, Shape.FULL, GROUND);
    for (let i = 0; i < 4; i++) {
      const tx = 5 + i;
      const ty = 11 - i;
      map.set(tx, ty, Shape.SLOPE_STEEP_R, GROUND);
      map.fill(tx, ty + 1, tx, 14, Shape.FULL, GROUND);
    }
    map.fill(9, 8, 19, 14, Shape.FULL, GROUND);
    return map;
  }

  it("walks up a rising slope instead of under it", () => {
    // The bug this catches: resolveY only ever looks DOWNWARD, so an actor on
    // flat ground never notices a slope surface climbing above its feet and
    // walks along the floor underneath it.
    const map = steepSlopeRoom();
    const a = actor(60, 180);
    let climbed = false;
    for (let i = 0; i < 60; i++) {
      const r = tick(map, a, fromPx(2));
      expect(r.grounded).toBe(true);
      expect(overlapsSolid(map, a.x, a.y, a.halfW, a.halfH)).toBe(false);
      if (px(a.y) < 180) climbed = true;
    }
    expect(climbed).toBe(true);
    expect(px(a.x)).toBeGreaterThan(140); // reached the upper ledge
    expect(px(a.y)).toBe(116); // standing on the y=128 upper floor
  });

  it("stays attached running downhill instead of bouncing", () => {
    const map = steepSlopeRoom();
    const a = actor(150, 116);
    for (let i = 0; i < 40; i++) {
      const r = tick(map, a, fromPx(-2));
      // Losing contact here is what makes a character judder down a hill.
      expect(r.grounded).toBe(true);
    }
    expect(px(a.y)).toBe(180); // back down on the lower floor
  });

  it("keeps a WIDE actor's corners out of the slope", () => {
    // Sampling the surface at the actor's centre lets half a wide body sink
    // into a 1:1 slope. Both bottom corners must be considered.
    const map = steepSlopeRoom();
    const wide = actor(70, 150, { halfW: fromPx(16) });
    for (let i = 0; i < 40; i++) {
      tick(map, wide, fromPx(1));
      expect(overlapsSolid(map, wide.x, wide.y, wide.halfW, wide.halfH)).toBe(false);
    }
  });

  it("does not crush you on a slope running under a low overhang", () => {
    // A new player will build this in their first level. Snapping up the slope without
    // checking headroom embeds the actor in the ceiling, where the crush rule
    // kills it instantly with no visible cause.
    const map = new Tilemap(20, 15);
    map.fill(0, 12, 19, 14, Shape.FULL, GROUND);
    map.set(6, 11, Shape.SLOPE_STEEP_R, GROUND);
    map.set(7, 10, Shape.SLOPE_STEEP_R, GROUND);
    map.fill(7, 11, 7, 11, Shape.FULL, GROUND);
    map.fill(5, 9, 12, 9, Shape.FULL, GROUND); // ceiling too low to climb under

    const a = actor(60, 180);
    for (let i = 0; i < 40; i++) {
      tick(map, a, fromPx(2));
      // The actor may stop, but must never end up inside solid geometry.
      expect(overlapsSolid(map, a.x, a.y, a.halfW, a.halfH)).toBe(false);
    }
  });
});

describe("overlapsSolid", () => {
  it("reports an embedded box and a resting box differently", () => {
    const map = flatRoom();
    // Resting exactly on the floor is NOT an overlap.
    expect(overlapsSolid(map, fromPx(80), fromPx(180), fromPx(6), fromPx(12))).toBe(false);
    // One pixel lower is.
    expect(overlapsSolid(map, fromPx(80), fromPx(181), fromPx(6), fromPx(12))).toBe(true);
  });

  it("treats out-of-bounds sides and top as solid, and below as open", () => {
    const map = flatRoom();
    expect(map.isSolid(-1, 5)).toBe(true);
    expect(map.isSolid(5, -1)).toBe(true);
    expect(map.isSolid(5, 99)).toBe(false); // the pit
  });
});

describe("ground material", () => {
  it("reports the flags of the surface being stood on", () => {
    const map = flatRoom();
    map.fill(5, 12, 8, 12, Shape.FULL, TileFlags.SOLID | TileFlags.ICE);
    const a = actor(100, 150);
    const r = run(map, a, 30);
    expect(r.grounded).toBe(true);
    expect(r.groundFlags & TileFlags.ICE).toBeTruthy();
  });
});
