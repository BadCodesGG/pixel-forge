import { MAX_ENTITIES } from "./constants";

/**
 * GENERATIONAL ENTITY HANDLES.
 *
 * An `EntityId` packs a slot index and a generation counter into one number.
 * The generation increments every time a slot is reused, so a handle kept
 * across frames can be checked for staleness:
 *
 *     shell.link = walkerId;      // remembered
 *     ...walker dies, slot recycled as a coin...
 *     isAlive(world, shell.link)  // false: generation no longer matches
 *
 * Without this, a stale handle silently resolves to whatever now occupies the
 * slot, and a shell starts following a coin. That bug is intermittent, depends
 * on spawn order, and is close to impossible to reproduce from a report.
 *
 * ---------------------------------------------------------------------------
 * THE SPLIT: 1024 indices, ~1M generations
 * ---------------------------------------------------------------------------
 * The instinct is to give the index most of the bits, but that is backwards.
 * There are only 512 entity slots ever, so the index needs 10 bits. Every
 * remaining bit should go to the generation, because generation wraparound is
 * the failure mode: fireballs, coins and particles recycle the same slots
 * constantly, and once a generation wraps, a stale handle validates again.
 *
 * At 1,048,576 generations, a slot recycled *every single frame* takes about
 * five hours of continuous play to wrap, and real recycling is orders of
 * magnitude slower than that.
 *
 * ---------------------------------------------------------------------------
 * WHY ARITHMETIC AND NOT BIT-PACKING
 * ---------------------------------------------------------------------------
 * The natural implementation is `(gen << 10) | index`. Bitwise operators are
 * banned in the engine (see math/fixed.ts) because they coerce to int32, and
 * rather than carve out an exception for a case where the ban is not strictly
 * necessary, this uses multiply/divide/modulo. It is exact, it reads more
 * clearly, and the largest possible id (2^30) still fits in the Int32Array
 * fields that store entity references.
 */

/** An opaque handle to an entity. Never construct one by hand. */
export type EntityId = number & { readonly __entity: unique symbol };

/** The "no entity" handle. Generation 0 is never issued, so 0 is always invalid. */
export const NULL_ENTITY = 0 as EntityId;

/**
 * Index stride. Must exceed MAX_ENTITIES; a power of two keeps the divide and
 * modulo cheap.
 */
export const INDEX_SPAN = 1024;

/**
 * Generations are taken modulo this. INDEX_SPAN * GEN_SPAN = 2^30, which stays
 * comfortably inside int32 so entity references survive an Int32Array round trip.
 */
export const GEN_SPAN = 1048576; // 2^20

if (MAX_ENTITIES > INDEX_SPAN) {
  throw new Error(`MAX_ENTITIES (${MAX_ENTITIES}) must not exceed INDEX_SPAN (${INDEX_SPAN})`);
}

/** Build a handle. `generation` must be >= 1 so the result is never NULL_ENTITY. */
export function makeEntityId(index: number, generation: number): EntityId {
  return (generation * INDEX_SPAN + index) as EntityId;
}

/** The slot this handle refers to. Meaningless unless the handle is alive. */
export function entityIndex(id: EntityId): number {
  return id % INDEX_SPAN;
}

/** The generation this handle was issued in. */
export function entityGeneration(id: EntityId): number {
  return Math.floor(id / INDEX_SPAN);
}

/** Advance a slot's generation, wrapping back to 1 (never to 0). */
export function nextGeneration(generation: number): number {
  const next = generation + 1;
  return next >= GEN_SPAN ? 1 : next;
}
