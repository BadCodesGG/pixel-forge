import { describe, expect, it } from "vitest";
import { World } from "./world";
import { MAX_ENTITIES, SCRATCH_SLOTS } from "./constants";
import { NULL_ENTITY, entityIndex } from "./ids";
import { EntityFlags, hasAny } from "./flags";
import { scratchIndex } from "./components";
import { fromTiles, raw } from "../math/fixed";

function spawnDummy(world: World, kind = 1) {
  return world.spawn({
    kind,
    x: fromTiles(2),
    y: fromTiles(3),
    halfW: raw(4096),
    halfH: raw(4096),
  });
}

describe("World lifetime", () => {
  it("spawns, resolves and reports live entities", () => {
    const world = new World();
    const id = spawnDummy(world);
    expect(id).not.toBe(NULL_ENTITY);
    expect(world.isAlive(id)).toBe(true);
    expect(world.countActive()).toBe(1);

    const index = world.resolve(id);
    expect(world.store.x[index]).toBe(fromTiles(2));
    expect(world.store.kind[index]).toBe(1);
  });

  it("defers removal until sweep, so mid-iteration despawn is safe", () => {
    const world = new World();
    const id = spawnDummy(world);
    world.despawn(id);

    // Still resolvable this tick: a system iterating right now must not have
    // the slot vanish underneath it.
    expect(world.resolve(id)).toBeGreaterThanOrEqual(0);
    expect(hasAny(world.store.flags[world.resolve(id)], EntityFlags.DOOMED)).toBe(true);
    // ...but it no longer counts as an active participant.
    expect(world.isActive(entityIndex(id))).toBe(false);

    world.sweep();
    expect(world.isAlive(id)).toBe(false);
    expect(world.countActive()).toBe(0);
  });

  it("tolerates despawning the same entity twice in one tick", () => {
    const world = new World();
    const id = spawnDummy(world);
    world.despawn(id);
    world.despawn(id);
    world.sweep();
    expect(world.countActive()).toBe(0);

    // The slot must be released exactly once, or the free list corrupts and
    // two future entities share one slot.
    const a = spawnDummy(world);
    const b = spawnDummy(world);
    expect(entityIndex(a)).not.toBe(entityIndex(b));
  });
});

/**
 * The reason generational handles exist. Without the generation check, a stale
 * handle silently resolves to whatever now occupies the slot, and a shell ends
 * up following a coin.
 */
describe("stale handles", () => {
  it("does not resolve after the slot is reused", () => {
    const world = new World();
    const first = spawnDummy(world, 10);
    const slot = entityIndex(first);

    world.despawn(first);
    world.sweep();

    const second = spawnDummy(world, 20);
    expect(entityIndex(second)).toBe(slot); // same slot, reused immediately
    expect(second).not.toBe(first); // different handle

    expect(world.isAlive(first)).toBe(false);
    expect(world.resolve(first)).toBe(-1);
    expect(world.isAlive(second)).toBe(true);
  });

  it("treats NULL_ENTITY as dead", () => {
    const world = new World();
    expect(world.isAlive(NULL_ENTITY)).toBe(false);
    expect(world.resolve(NULL_ENTITY)).toBe(-1);
  });

  it("survives an Int32Array round trip, since handles live in link/ground", () => {
    const world = new World();
    const id = spawnDummy(world);
    const store = new Int32Array(1);
    store[0] = id;
    expect(store[0]).toBe(id);
    expect(world.isAlive(store[0] as typeof id)).toBe(true);
  });
});

describe("pool exhaustion", () => {
  it("fills exactly MAX_ENTITIES slots then returns NULL_ENTITY", () => {
    const world = new World();
    for (let i = 0; i < MAX_ENTITIES; i++) {
      expect(spawnDummy(world)).not.toBe(NULL_ENTITY);
    }
    expect(world.countActive()).toBe(MAX_ENTITIES);
    // Overflow must be a quiet, handled refusal, never a crash and never a
    // silent overwrite of a live entity.
    expect(spawnDummy(world)).toBe(NULL_ENTITY);
  });

  it("recovers capacity after a sweep", () => {
    const world = new World();
    const ids = Array.from({ length: MAX_ENTITIES }, () => spawnDummy(world));
    for (const id of ids) world.despawn(id);
    world.sweep();
    expect(world.countActive()).toBe(0);
    expect(spawnDummy(world)).not.toBe(NULL_ENTITY);
  });
});

describe("slot hygiene", () => {
  it("clears scratch on reuse so a trait cannot inherit stale state", () => {
    const world = new World();
    const first = spawnDummy(world);
    const slot = entityIndex(first);

    // Simulate a trait writing its private countdown.
    for (let i = 0; i < SCRATCH_SLOTS; i++) {
      world.store.scratch[scratchIndex(slot, i)] = 1234 + i;
    }

    world.despawn(first);
    world.sweep();
    spawnDummy(world);

    for (let i = 0; i < SCRATCH_SLOTS; i++) {
      expect(world.store.scratch[scratchIndex(slot, i)]).toBe(0);
    }
  });

  it("captures previous position for semisolid checks and interpolation", () => {
    const world = new World();
    const id = spawnDummy(world);
    const index = world.resolve(id);

    world.capturePrevious();
    world.store.y[index] = fromTiles(1);

    expect(world.store.prevY[index]).toBe(fromTiles(3));
    expect(world.store.y[index]).toBe(fromTiles(1));
  });
});

describe("determinism", () => {
  it("assigns identical slots for identical operation sequences", () => {
    const run = () => {
      const world = new World(42);
      const ids: number[] = [];
      for (let i = 0; i < 20; i++) ids.push(spawnDummy(world));
      for (let i = 0; i < 20; i += 2) world.despawn(ids[i] as never);
      world.sweep();
      for (let i = 0; i < 10; i++) ids.push(spawnDummy(world));
      return ids;
    };
    expect(run()).toEqual(run());
  });

  it("reset returns the world to a pristine state", () => {
    const world = new World(7);
    for (let i = 0; i < 50; i++) spawnDummy(world);
    world.tick = 999;
    world.reset();
    expect(world.countActive()).toBe(0);
    expect(world.tick).toBe(0);
    expect(entityIndex(spawnDummy(world))).toBe(0);
  });
});
