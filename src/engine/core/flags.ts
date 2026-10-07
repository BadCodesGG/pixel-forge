/* eslint-disable no-bitwise --
 * Bitfields are the point of this file.
 *
 * The engine-wide `no-bitwise` ban exists because bitwise operators coerce to
 * int32, which corrupts fixed-point coordinates that exceed it. Flag words are
 * by construction small (well under 2^31), so the coercion is a no-op here and
 * the hazard the rule guards against cannot occur. Every flag helper below is
 * a pure function over a single flag word, no coordinates pass through.
 */

/**
 * Material properties of a tile. Independent of its SHAPE (see tileShapes.ts):
 * a 45-degree slope can be ice, a full block can be a hazard.
 */
export const TileFlags = {
  NONE: 0,
  /** Blocks movement from every direction. */
  SOLID: 1 << 0,
  /**
   * Semisolid: blocks only downward movement, and only for an entity that was
   * already above the surface last tick. Passable from below and from the sides.
   */
  ONE_WAY: 1 << 1,
  /** Low friction. Applies to the player only; enemies are unaffected. */
  ICE: 1 << 2,
  /** Damages on contact (spikes). Not the same as lethal liquid. */
  HAZARD: 1 << 3,
  /** Instantly lethal regardless of power state (lava, poison). */
  LETHAL: 1 << 4,
  /** Can be destroyed by a sufficiently powerful hit. */
  BREAKABLE: 1 << 5,
  /** Climbable (vines). */
  CLIMB: 1 << 6,
  /** Swimmable volume. */
  WATER: 1 << 7,
  /** Counts toward a scroll-stop wall. Only ground and hard blocks qualify. */
  SCROLL_STOP: 1 << 8,
} as const;
export type TileFlag = number;

/** Per-entity state bits. */
export const EntityFlags = {
  NONE: 0,
  /** Slot is occupied. Cleared on despawn. */
  ACTIVE: 1 << 0,
  /** Resting on ground, a slope, or a moving platform this tick. */
  GROUNDED: 1 << 1,
  /** Affected by gravity. */
  GRAVITY: 1 << 2,
  /** Collides with the tilemap. Ghosts and background decor do not. */
  TILE_COLLIDE: 1 << 3,
  /**
   * A moving solid other entities can stand on and be carried by (lifts,
   * snake blocks, seesaws). Resolved in its own collision pass.
   */
  MOVING_SOLID: 1 << 4,
  /** Currently submerged. */
  IN_WATER: 1 << 5,
  /** Scheduled for removal at the end of the tick. */
  DOOMED: 1 << 6,
  /** Exempt from off-camera despawn (the player, level-critical objects). */
  PERSISTENT: 1 << 7,
  /** Faces left. When clear, faces right. Mirrors the `face` component. */
  FACE_LEFT: 1 << 8,
} as const;

/**
 * Combine flag constants into one word.
 *
 * Engine source cannot write `EntityFlags.GRAVITY | EntityFlags.TILE_COLLIDE`
 * directly, because `no-bitwise` is on everywhere outside this file. Rather
 * than punching a hole in the rule at every call site, callers compose through
 * here, the ban stays meaningful, and the one place bitwise is genuinely safe
 * stays contained.
 */
export function combine(...masks: number[]): number {
  let word = 0;
  for (const m of masks) word |= m;
  return word;
}

/** True if every bit in `mask` is set in `word`. */
export function hasAll(word: number, mask: number): boolean {
  return (word & mask) === mask;
}

/** True if any bit in `mask` is set in `word`. */
export function hasAny(word: number, mask: number): boolean {
  return (word & mask) !== 0;
}

export function withFlags(word: number, mask: number): number {
  return word | mask;
}

export function withoutFlags(word: number, mask: number): number {
  return word & ~mask;
}

export function setFlags(word: number, mask: number, on: boolean): number {
  return on ? word | mask : word & ~mask;
}
