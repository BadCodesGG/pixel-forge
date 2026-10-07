import { describe, expect, it } from "vitest";
import { fromPx, toPxFloat, type Fixed } from "../math/fixed";
import { EntityFlags, TileFlags } from "../core/flags";
import { NULL_ENTITY } from "../core/ids";
import { World } from "../core/world";
import { Tilemap } from "./tilemap";
import { Shape } from "./tileShapes";
import { moveActor, type Actor, type MoveResult } from "./resolve";
import { carryRiders, collideWithMovingSolids, detachFromPlatform } from "./platforms";

const GRAVITY = fromPx(0.4375);
/** Accepts a plain number so typed-array reads (`store.x[i]`) work directly. */
const px = (v: number) => toPxFloat(v as Fixed);

function room(): Tilemap {
  const map = new Tilemap(20, 15);
  map.fill(0, 12, 19, 14, Shape.FULL, TileFlags.SOLID);
  return map;
}

/** A 32x8 px lift. */
function spawnLift(world: World, xPx: number, yPx: number) {
  return world.spawn({
    kind: 100,
    x: fromPx(xPx),
    y: fromPx(yPx),
    halfW: fromPx(16),
    halfH: fromPx(4),
    flags: EntityFlags.MOVING_SOLID | EntityFlags.PERSISTENT,
  });
}

function spawnPlayer(world: World, xPx: number, yPx: number) {
  return world.spawn({
    kind: 1,
    x: fromPx(xPx),
    y: fromPx(yPx),
    halfW: fromPx(6),
    halfH: fromPx(12),
    flags: EntityFlags.GRAVITY | EntityFlags.TILE_COLLIDE | EntityFlags.PERSISTENT,
  });
}

/**
 * One full tick in the prescribed order: platforms move, riders are carried,
 * the actor integrates and resolves against tiles, then against platforms.
 */
function tick(
  world: World,
  map: Tilemap,
  playerIndex: number,
  liftIndex: number,
  liftVy: Fixed,
  playerVx: Fixed = 0 as Fixed,
  liftVx: Fixed = 0 as Fixed,
): MoveResult {
  const s = world.store;
  world.capturePrevious();

  // 1. Platform integrates.
  s.y[liftIndex] = (s.y[liftIndex] + liftVy) as Fixed;
  s.x[liftIndex] = (s.x[liftIndex] + liftVx) as Fixed;

  // 2. Riders are carried by position.
  carryRiders(world, map);

  // 3 & 4. Actor integrates and resolves against the tilemap.
  const a: Actor = {
    x: s.x[playerIndex] as Fixed,
    y: s.y[playerIndex] as Fixed,
    vx: playerVx,
    vy: (s.vy[playerIndex] + GRAVITY) as Fixed,
    halfW: s.halfW[playerIndex] as Fixed,
    halfH: s.halfH[playerIndex] as Fixed,
    prevBottom: (s.prevY[playerIndex] + s.halfH[playerIndex]) as Fixed,
    wasGrounded: s.ground[playerIndex] !== NULL_ENTITY,
  };
  const r = moveActor(map, a);

  // 5. Then against moving solids.
  s.x[playerIndex] = a.x;
  s.y[playerIndex] = a.y;
  s.vy[playerIndex] = a.vy;
  collideWithMovingSolids(world, playerIndex, a, r);
  s.x[playerIndex] = a.x;
  s.y[playerIndex] = a.y;
  s.vy[playerIndex] = a.vy;
  return r;
}

describe("moving solids", () => {
  it("catches an actor that would otherwise fall straight through", () => {
    // Without a dedicated entity pass this is exactly what happens: the
    // tilemap resolver has never heard of the lift.
    const world = new World();
    const map = room();
    const lift = world.resolve(spawnLift(world, 100, 140));
    const player = world.resolve(spawnPlayer(world, 100, 100));

    let landed = false;
    for (let i = 0; i < 30 && !landed; i++) {
      landed = tick(world, map, player, lift, 0 as Fixed).grounded;
    }
    expect(landed).toBe(true);
    // Lift top is 136; a 24px-tall actor rests with its centre 12px above.
    expect(px(world.store.y[player])).toBe(124);
    expect(world.store.ground[player]).not.toBe(NULL_ENTITY);
  });

  it("carries a rider upward without leaving it behind", () => {
    const world = new World();
    const map = room();
    const lift = world.resolve(spawnLift(world, 100, 140));
    const player = world.resolve(spawnPlayer(world, 100, 124));
    world.store.ground[player] = world.idAt(lift);

    for (let i = 0; i < 20; i++) {
      const r = tick(world, map, player, lift, fromPx(-1));
      expect(r.grounded).toBe(true);
    }
    // Lift rose 20px; the rider must have risen exactly with it.
    expect(px(world.store.y[lift])).toBe(120);
    expect(px(world.store.y[player])).toBe(104);
  });

  it("carries a rider downward without it hovering", () => {
    const world = new World();
    const map = room();
    const lift = world.resolve(spawnLift(world, 100, 100));
    const player = world.resolve(spawnPlayer(world, 100, 84));
    world.store.ground[player] = world.idAt(lift);

    for (let i = 0; i < 20; i++) {
      const r = tick(world, map, player, lift, fromPx(1));
      expect(r.grounded).toBe(true);
    }
    expect(px(world.store.y[lift])).toBe(120);
    expect(px(world.store.y[player])).toBe(104);
  });

  it("does not double-integrate the platform's motion", () => {
    // The bug this catches: adding the platform delta to the rider's VELOCITY
    // instead of its position, so the rider accelerates off the front.
    const world = new World();
    const map = room();
    const lift = world.resolve(spawnLift(world, 100, 140));
    const player = world.resolve(spawnPlayer(world, 100, 124));
    world.store.ground[player] = world.idAt(lift);

    for (let i = 0; i < 30; i++) {
      const r = tick(world, map, player, lift, 0 as Fixed, 0 as Fixed, fromPx(2));
      expect(r.grounded).toBe(true);
    }
    // Rider and platform must have travelled the same distance, exactly.
    expect(px(world.store.x[player])).toBe(px(world.store.x[lift]));
    expect(px(world.store.x[lift])).toBe(160);
  });

  it("lets an actor jump up through a platform from below", () => {
    const world = new World();
    const map = room();
    const lift = world.resolve(spawnLift(world, 100, 140));
    const player = world.resolve(spawnPlayer(world, 100, 180));

    const s = world.store;
    // -8 px/frame peaks ~73px up, clearing the 56px from the floor to the lift.
    s.vy[player] = fromPx(-8);
    let blockedAt = -1;
    for (let i = 0; i < 14; i++) {
      const r = tick(world, map, player, lift, 0 as Fixed);
      if (r.grounded && blockedAt < 0) blockedAt = i;
    }
    expect(blockedAt, `caught by the platform on tick ${blockedAt}`).toBe(-1);
    expect(px(s.y[player])).toBeLessThan(124); // above the lift's surface
  });

  it("drops a stale reference when the platform is destroyed", () => {
    const world = new World();
    const map = room();
    const liftId = spawnLift(world, 100, 140);
    const player = world.resolve(spawnPlayer(world, 100, 124));
    world.store.ground[player] = liftId;

    world.despawn(liftId);
    world.sweep();
    world.capturePrevious();
    carryRiders(world, map);

    expect(world.store.ground[player]).toBe(NULL_ENTITY);
  });

  it("detaches on demand, so jumping does not drag the rider along", () => {
    const world = new World();
    const player = world.resolve(spawnPlayer(world, 100, 124));
    world.store.ground[player] = spawnLift(world, 100, 140);
    detachFromPlatform(world, player);
    expect(world.store.ground[player]).toBe(NULL_ENTITY);
  });

  it("keeps a wall winning over a platform that pushes into it", () => {
    const world = new World();
    const map = room();
    // The wall must reach up to the rider's own height (y 112..136), not just
    // to the lift's height; otherwise the rider simply sails over the top of it.
    map.fill(10, 5, 10, 11, Shape.FULL, TileFlags.SOLID); // wall at x=160, y=80..192
    const lift = world.resolve(spawnLift(world, 100, 140));
    const player = world.resolve(spawnPlayer(world, 100, 124));
    world.store.ground[player] = world.idAt(lift);

    const s = world.store;
    for (let i = 0; i < 40; i++) {
      tick(world, map, player, lift, 0 as Fixed, 0 as Fixed, fromPx(2));
    }
    // The platform sailed on; the rider is stopped flush against the wall
    // rather than being smeared through it.
    expect(px(s.x[player])).toBe(154);
    expect(px(s.x[lift])).toBeGreaterThan(154);
  });
});

