import { Rng } from "../math/rng";
import type { Fixed } from "../math/fixed";
import { MAX_ENTITIES } from "./constants";
import { ComponentStore } from "./components";
import { EntityFlags, hasAll, hasAny, withFlags } from "./flags";
import {
  NULL_ENTITY,
  entityGeneration,
  entityIndex,
  makeEntityId,
  nextGeneration,
  type EntityId,
} from "./ids";

export interface SpawnOptions {
  kind: number;
  x: Fixed;
  y: Fixed;
  halfW: Fixed;
  halfH: Fixed;
  flags?: number;
  face?: -1 | 1;
  hp?: number;
  /** Index into the compiled spawn table, so streaming can avoid double-spawns. */
  spawnIndex?: number;
}

/**
 * The mutable simulation state.
 *
 * `World` owns entity lifetime and nothing else: no physics, no rendering, no
 * knowledge of what a walker is. Systems read and write the component arrays;
 * parts supply behaviour. Keeping lifetime separate is what lets the whole
 * world be snapshotted and restored without any system participating.
 */
export class World {
  readonly store = new ComponentStore();
  readonly rng: Rng;

  /** Ticks elapsed since the level started. The sim's only clock. */
  tick = 0;

  /**
   * Free slots, used as a stack.
   *
   * Seeded in descending order so the first spawn takes slot 0 and early
   * entities land in low, stable slots, which makes a debug dump readable
   * without changing any behaviour.
   */
  private readonly freeSlots = new Int32Array(MAX_ENTITIES);
  private freeCount = MAX_ENTITIES;

  /** Slots flagged DOOMED this tick, released during `sweep()`. */
  private readonly doomed = new Int32Array(MAX_ENTITIES);
  private doomedCount = 0;

  constructor(seed = 1) {
    this.rng = new Rng(seed);
    this.reset();
  }

  reset(): void {
    this.tick = 0;
    this.freeCount = MAX_ENTITIES;
    this.doomedCount = 0;
    for (let i = 0; i < MAX_ENTITIES; i++) {
      this.freeSlots[i] = MAX_ENTITIES - 1 - i;
      this.store.clear(i);
      this.store.generation[i] = 1; // generation 0 is never issued
    }
  }

  // -------------------------------------------------------------------------
  // Lifetime
  // -------------------------------------------------------------------------

  /** Spawn an entity, or return NULL_ENTITY if the pool is exhausted. */
  spawn(options: SpawnOptions): EntityId {
    if (this.freeCount === 0) return NULL_ENTITY;

    this.freeCount -= 1;
    const index = this.freeSlots[this.freeCount];
    const s = this.store;

    s.clear(index);
    s.kind[index] = options.kind;
    s.x[index] = options.x;
    s.y[index] = options.y;
    s.prevX[index] = options.x;
    s.prevY[index] = options.y;
    s.halfW[index] = options.halfW;
    s.halfH[index] = options.halfH;
    s.face[index] = options.face ?? 1;
    s.hp[index] = options.hp ?? 1;
    s.spawnIndex[index] = options.spawnIndex ?? -1;
    s.flags[index] = withFlags(options.flags ?? 0, EntityFlags.ACTIVE);

    return makeEntityId(index, s.generation[index]);
  }

  /**
   * Mark an entity for removal at the end of the tick.
   *
   * Removal is deferred rather than immediate because a system is usually
   * iterating when something dies. Freeing the slot mid-iteration would let a
   * newly spawned entity land in it and be visited twice in the same tick: a
   * bug that only shows up under specific spawn timings.
   */
  despawn(id: EntityId): void {
    const index = this.resolve(id);
    if (index < 0) return;
    const s = this.store;
    if (hasAny(s.flags[index], EntityFlags.DOOMED)) return;
    s.flags[index] = withFlags(s.flags[index], EntityFlags.DOOMED);
    this.doomed[this.doomedCount++] = index;
  }

  /** Release every slot marked DOOMED. Call once, at the end of the tick. */
  sweep(): void {
    const s = this.store;
    for (let i = 0; i < this.doomedCount; i++) {
      const index = this.doomed[i];
      // Bumping the generation is what invalidates every handle still pointing
      // here, so a stale `link` or `ground` reference cannot resolve.
      s.generation[index] = nextGeneration(s.generation[index]);
      s.clear(index);
      this.freeSlots[this.freeCount++] = index;
    }
    this.doomedCount = 0;
  }

  /** True if the handle still refers to the entity it was issued for. */
  isAlive(id: EntityId): boolean {
    return this.resolve(id) >= 0;
  }

  /**
   * Slot index for a handle, or -1 if it is stale, null, or despawned.
   *
   * Every system that dereferences a stored handle must go through this. The
   * generation check is the entire defence against a shell chasing whatever
   * object happens to occupy its dead owner's slot.
   */
  resolve(id: EntityId): number {
    if (id === NULL_ENTITY) return -1;
    const index = entityIndex(id);
    if (index >= MAX_ENTITIES) return -1;
    if (this.store.generation[index] !== entityGeneration(id)) return -1;
    if (!hasAll(this.store.flags[index], EntityFlags.ACTIVE)) return -1;
    return index;
  }

  /** Handle for a slot index. Only valid while that slot is active. */
  idAt(index: number): EntityId {
    return makeEntityId(index, this.store.generation[index]);
  }

  // -------------------------------------------------------------------------
  // Iteration
  // -------------------------------------------------------------------------

  /**
   * True if the slot holds a live, non-doomed entity.
   *
   * Systems scan all MAX_ENTITIES slots and skip the empty ones rather than
   * walking a compacted list. A dense list with swap-remove would be marginally
   * faster, but its iteration order depends on the entire history of removals,
   * which makes a desync harder to reason about and a debug dump harder to
   * read. At 512 slots the scan costs microseconds; determinism that is obvious
   * by construction is worth far more than that here.
   */
  isActive(index: number): boolean {
    const f = this.store.flags[index];
    return hasAll(f, EntityFlags.ACTIVE) && !hasAny(f, EntityFlags.DOOMED);
  }

  /** Live entity count. O(capacity); for debug output and tests, not hot paths. */
  countActive(): number {
    let n = 0;
    for (let i = 0; i < MAX_ENTITIES; i++) if (this.isActive(i)) n++;
    return n;
  }

  /** Record every entity's position as of the start of this tick. */
  capturePrevious(): void {
    const s = this.store;
    for (let i = 0; i < MAX_ENTITIES; i++) {
      if (!this.isActive(i)) continue;
      s.prevX[i] = s.x[i];
      s.prevY[i] = s.y[i];
    }
  }
}
