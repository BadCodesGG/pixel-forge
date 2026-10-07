import { MAX_ENTITIES, SCRATCH_SLOTS } from "./constants";

/**
 * STRUCTURE-OF-ARRAYS ENTITY STORAGE.
 *
 * Every entity property lives in its own typed array, indexed by slot. An
 * entity is not an object: it is an index that several arrays agree on.
 *
 * Three reasons this shape rather than a class per enemy:
 *
 *   1. ZERO ALLOCATION. Everything is allocated once at boot. A 60Hz loop that
 *      allocates produces GC pauses, and a GC pause is a dropped frame the
 *      player feels as a stutter at exactly the wrong moment.
 *
 *   2. SNAPSHOTTABLE. The whole world state is a handful of typed arrays, so
 *      capturing it is a set of `.set()` calls. That is what makes rewind-on-
 *      death cheap, and what lets a desync be bisected to the exact frame.
 *
 *   3. DETERMINISTIC ITERATION. Systems walk a dense array in index order.
 *      There is no Map, no Set, no object-key ordering, nothing whose
 *      iteration order could differ between engines or between runs.
 */
export class ComponentStore {
  readonly capacity = MAX_ENTITIES;

  // --- Identity ------------------------------------------------------------
  /** Generation counter per slot. Paired with the index to form an EntityId. */
  readonly generation = new Uint32Array(MAX_ENTITIES);
  /** PartDef numeric id, the behaviour dispatch key. */
  readonly kind = new Uint16Array(MAX_ENTITIES);
  /** EntityFlags bitfield. */
  readonly flags = new Uint32Array(MAX_ENTITIES);

  // --- Transform (all Fixed, 1/4096 px) ------------------------------------
  readonly x = new Int32Array(MAX_ENTITIES);
  readonly y = new Int32Array(MAX_ENTITIES);
  readonly vx = new Int32Array(MAX_ENTITIES);
  readonly vy = new Int32Array(MAX_ENTITIES);
  /** Half-extents from the entity's centre. */
  readonly halfW = new Int32Array(MAX_ENTITIES);
  readonly halfH = new Int32Array(MAX_ENTITIES);

  /**
   * Position at the start of this tick.
   *
   * Load-bearing for two things: semisolid platforms need to know whether the
   * entity was above the surface *before* it moved (testing only the current
   * position is the classic bug that snaps entities onto platforms they walked
   * into from the side), and the renderer interpolates between previous and
   * current when the display refresh exceeds the tick rate.
   */
  readonly prevX = new Int32Array(MAX_ENTITIES);
  readonly prevY = new Int32Array(MAX_ENTITIES);

  // --- Common behaviour state ---------------------------------------------
  /** Part-defined state machine index. */
  readonly state = new Uint8Array(MAX_ENTITIES);
  /**
   * General countdown owned by the entity's PRIMARY behaviour: a death
   * animation, a respawn delay.
   *
   * Composed traits must NOT reach for this; they get disjoint slots in
   * `scratch` instead. Sharing one timer between a flatten countdown and a
   * burner phase is exactly the collision the scratch scheme exists to prevent,
   * and it fails intermittently, which is the worst way to fail.
   */
  readonly timer = new Int16Array(MAX_ENTITIES);
  /** -1 (left) or +1 (right). */
  readonly face = new Int8Array(MAX_ENTITIES);
  readonly hp = new Int8Array(MAX_ENTITIES);

  /** The MOVING_SOLID entity carrying this one, or NULL_ENTITY. */
  readonly ground = new Int32Array(MAX_ENTITIES);
  /** General-purpose link: shell -> owner, projectile -> shooter, door -> pair. */
  readonly link = new Int32Array(MAX_ENTITIES);

  /** Index into the compiled spawn table, so a despawned entity is not re-spawned twice. */
  readonly spawnIndex = new Int32Array(MAX_ENTITIES);

  /**
   * Private per-trait scratch, SCRATCH_SLOTS ints per entity.
   *
   * Addressed as `scratch[entityIndex * SCRATCH_SLOTS + slot]`, where `slot` is
   * assigned to each trait at module-init time so two composed traits can never
   * collide. See `scratchIndex` below and parts/compose.
   */
  readonly scratch = new Int32Array(MAX_ENTITIES * SCRATCH_SLOTS);

  /**
   * Reset one slot to a known-empty state.
   *
   * Every field is cleared explicitly. Leaving stale values behind is how an
   * entity inherits the previous occupant's timer and behaves "randomly": the
   * exact class of bug the generational handle scheme exists to prevent, so it
   * would be careless to reintroduce it here.
   */
  clear(index: number): void {
    this.kind[index] = 0;
    this.flags[index] = 0;
    this.x[index] = 0;
    this.y[index] = 0;
    this.vx[index] = 0;
    this.vy[index] = 0;
    this.halfW[index] = 0;
    this.halfH[index] = 0;
    this.prevX[index] = 0;
    this.prevY[index] = 0;
    this.state[index] = 0;
    this.timer[index] = 0;
    this.face[index] = 1;
    this.hp[index] = 0;
    this.ground[index] = 0;
    this.link[index] = 0;
    this.spawnIndex[index] = -1;

    const base = index * SCRATCH_SLOTS;
    for (let i = 0; i < SCRATCH_SLOTS; i++) this.scratch[base + i] = 0;
  }
}

/**
 * Address of a trait's scratch slot for one entity.
 *
 * `slot` comes from the trait's assignment at composition time, never from a
 * literal at the call site, and that is what makes collisions impossible rather
 * than merely unlikely.
 */
export function scratchIndex(entityIndex: number, slot: number): number {
  return entityIndex * SCRATCH_SLOTS + slot;
}
