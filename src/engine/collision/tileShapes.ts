import { ONE, TILE, TILE_PX, lerp, type Fixed } from "../math/fixed";

/**
 * TILE GEOMETRY.
 *
 * A tile's SHAPE is its collision outline; its FLAGS (see core/flags.ts) are
 * its material. They are deliberately separate so a 45-degree slope can be made
 * of ice, or a full block can be a hazard, without multiplying the shape table.
 *
 * ---------------------------------------------------------------------------
 * COORDINATE CONVENTION
 * ---------------------------------------------------------------------------
 * The simulation uses +Y DOWN, with the origin at the top-left of the area.
 *
 * That is the opposite of the level *document*, which stores tiles bottom-left
 * with +Y up because that is how a person thinks about building a level. The
 * flip happens exactly once, in `compile()`. Doing it there rather than at each
 * use means no system ever has to ask which way is up.
 *
 * +Y down is also what the physics constants expect: gravity is a positive
 * addition to vy, terminal fall speed is positive, and a jump impulse is
 * negative. With that sign convention the physics tables stay simple instead
 * of needing every sign flipped.
 */

/**
 * Shapes are stored as a byte per tile.
 *
 * The slope set is deliberately small: gentle (1:2, spanning
 * two tiles) and steep (1:1, one tile), each in both directions. A gentle slope
 * needs two shapes because it climbs half a tile per tile.
 */
export const Shape = {
  EMPTY: 0,
  /** Fills the tile. Blocks from every direction if TileFlags.SOLID is set. */
  FULL: 1,

  /** Steep 1:1, rising left-to-right: floor at the left edge, ceiling at the right. */
  SLOPE_STEEP_R: 2,
  /** Steep 1:1, rising right-to-left. */
  SLOPE_STEEP_L: 3,

  /** Gentle 1:2 rising left-to-right, lower half (0 -> 1/2 tile). */
  SLOPE_GENTLE_R_LO: 4,
  /** Gentle 1:2 rising left-to-right, upper half (1/2 -> full tile). */
  SLOPE_GENTLE_R_HI: 5,
  /** Gentle 1:2 rising right-to-left, upper half (full -> 1/2 tile). */
  SLOPE_GENTLE_L_HI: 6,
  /** Gentle 1:2 rising right-to-left, lower half (1/2 -> 0). */
  SLOPE_GENTLE_L_LO: 7,
} as const;
export type ShapeId = number;

export const SHAPE_COUNT = 8;

/**
 * Surface height at each tile edge, in pixels above the tile's BOTTOM.
 *
 * Two endpoints and a straight interpolation covers every slope in the set. A
 * full 16-entry heightmap per shape would allow curves, but nothing in the part
 * roster is curved, and two endpoints keep the surface exactly linear, which
 * matters because a player walking a long slope must not feel per-pixel steps.
 */
const SLOPE_LEFT_PX: readonly number[] = [0, 0, 0, TILE_PX, 0, TILE_PX / 2, TILE_PX, TILE_PX / 2];
const SLOPE_RIGHT_PX: readonly number[] = [0, 0, TILE_PX, 0, TILE_PX / 2, TILE_PX, TILE_PX / 2, 0];

/** True if the shape has a sloped upper surface. */
export function isSlope(shape: ShapeId): boolean {
  return shape >= Shape.SLOPE_STEEP_R;
}

/** True if the shape occupies the whole tile. */
export function isFull(shape: ShapeId): boolean {
  return shape === Shape.FULL;
}

/** True if the shape has any collidable surface at all. */
export function isOccupied(shape: ShapeId): boolean {
  return shape !== Shape.EMPTY;
}

/**
 * Height of the slope surface above the tile's bottom edge, at `localX`.
 *
 * `localX` is the offset into the tile, in Fixed, clamped to [0, TILE]. The
 * clamp matters: a wide actor samples its corners, and a corner may sit outside
 * the tile it is being tested against. Clamping extends the surface flat past
 * the edge, which is exactly the behaviour you want at a slope-to-flat seam:
 * without it the actor drops a pixel at every tile boundary.
 */
export function slopeHeightAt(shape: ShapeId, localX: Fixed): Fixed {
  const clamped = localX < 0 ? 0 : localX > TILE ? TILE : localX;
  const left = (SLOPE_LEFT_PX[shape] * ONE) as Fixed;
  const right = (SLOPE_RIGHT_PX[shape] * ONE) as Fixed;
  // t is the fraction across the tile, expressed in Fixed (ONE == 1.0).
  const t = Math.floor((clamped * ONE) / TILE) as Fixed;
  return lerp(left, right, t);
}

/**
 * World Y of the slope's surface for a tile whose top edge is at `tileTop`.
 *
 * Remember +Y is down: a taller surface has a SMALLER y. Callers comparing two
 * candidate surfaces want the minimum, not the maximum.
 */
export function slopeSurfaceY(shape: ShapeId, tileTop: Fixed, localX: Fixed): Fixed {
  const bottom = (tileTop + TILE) as Fixed;
  return (bottom - slopeHeightAt(shape, localX)) as Fixed;
}
