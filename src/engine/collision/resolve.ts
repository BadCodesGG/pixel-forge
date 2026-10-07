import { ONE, TILE, fromPx, type Fixed } from "../math/fixed";
import { TileFlags, hasAny } from "../core/flags";
import { Tilemap } from "./tilemap";
import { Shape, isSlope, slopeSurfaceY } from "./tileShapes";

/**
 * TILE COLLISION.
 *
 * Discrete, axis-separated resolution: move on X and push out, then move on Y
 * and push out. Not a swept AABB.
 *
 * WHY AXIS-SEPARATED: resolving both axes at once has to guess which one caused
 * a corner overlap, and it guesses wrong often enough to be noticeable:
 * running into a corner launches you upward, or a jump against a wall snags.
 * Doing X first and Y second is what produces correct wall-sliding, and it is
 * what the movement behaviour is built around.
 *
 * WHY NOT SWEPT: the top speeds here are 2.5 px/frame horizontally and 4.5
 * px/frame vertically against a 16 px tile, so tunnelling is impossible at
 * normal speeds. Sub-stepping (below) covers the abnormal ones (springs,
 * pipes, debug fly) at a fraction of the complexity, and without diverging
 * from the behaviour the physics constants were tuned against.
 */

/** Farthest an actor is lifted in one tick to stay on a rising slope. */
export const SLOPE_SNAP_UP: Fixed = fromPx(8);

/**
 * Farthest an actor is pulled down to stay attached while running downhill.
 *
 * Without this the actor leaves the surface at the crest of every slope and
 * bounces down it. The value must exceed the vertical drop covered in one tick
 * at top speed: 2.5 px/frame on a 1:1 slope is 2.5 px, so 8 px is generous
 * without being enough to yank the actor down a genuine ledge.
 */
export const SLOPE_SNAP_DOWN: Fixed = fromPx(8);

export interface Actor {
  x: Fixed;
  y: Fixed;
  vx: Fixed;
  vy: Fixed;
  halfW: Fixed;
  halfH: Fixed;
  /** Bottom edge at the start of the tick, required for semisolid tests. */
  prevBottom: Fixed;
  /**
   * Whether the actor was standing on something at the end of the previous
   * tick. Supplied by the caller, not inferred.
   *
   * This is what allows the downhill snap: an actor already on the ground stays
   * attached to a surface that drops away beneath it, while an airborne one
   * must fall the full distance. Inferring it from `prevBottom` gets the
   * descending case backwards, because the new surface is below the old one.
   */
  wasGrounded?: boolean;
  /** Ignore semisolid platforms (drop-through). */
  dropThrough?: boolean;
}

export interface MoveResult {
  grounded: boolean;
  hitCeiling: boolean;
  hitWallLeft: boolean;
  hitWallRight: boolean;
  onSlope: boolean;
  /** Material flags of the surface being stood on (ICE, CONVEYOR, HAZARD...). */
  groundFlags: number;
}

/** A surface far below anything real, used as "no surface found". */
const NO_SURFACE = 0x3fffffff as Fixed;

// ---------------------------------------------------------------------------
// Overlap queries
// ---------------------------------------------------------------------------

/**
 * True if a box at (x, y) overlaps any fully-solid tile.
 *
 * Slope tiles are excluded: they are floor-only surfaces, not blockers. Testing
 * them here would make an actor standing correctly on a slope report as
 * embedded in it.
 */
export function overlapsSolid(
  map: Tilemap,
  x: Fixed,
  y: Fixed,
  halfW: Fixed,
  halfH: Fixed,
): boolean {
  const tx0 = Tilemap.tileX((x - halfW) as Fixed);
  const tx1 = Tilemap.tileXExclusive((x + halfW) as Fixed);
  const ty0 = Tilemap.tileY((y - halfH) as Fixed);
  const ty1 = Tilemap.tileYExclusive((y + halfH) as Fixed);

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      if (map.isSolid(tx, ty) && !isSlope(map.shapeAt(tx, ty))) return true;
    }
  }
  return false;
}

/**
 * Highest floor surface directly beneath a box, searching down to `maxDrop`.
 *
 * Returns NO_SURFACE when there is nothing to stand on.
 *
 * Three surface kinds are considered together, because an actor can straddle
 * all three at once and the correct answer is simply the highest of them:
 *
 *   - full solid tiles, whose surface is the tile's top edge;
 *   - semisolid tiles, but only when the actor was already above them (see
 *     `prevBottom` below);
 *   - slope tiles, sampled along the actor's footprint.
 *
 * Remember +Y is down, so "highest" is the SMALLEST y.
 */
export function floorSurfaceUnder(
  map: Tilemap,
  x: Fixed,
  bottom: Fixed,
  halfW: Fixed,
  prevBottom: Fixed,
  maxDrop: Fixed,
  dropThrough = false,
): { y: Fixed; flags: number; slope: boolean } {
  const left = (x - halfW) as Fixed;
  const right = (x + halfW) as Fixed;
  const tx0 = Tilemap.tileX(left);
  const tx1 = Tilemap.tileXExclusive(right);
  const ty0 = Tilemap.tileY(bottom);
  const ty1 = Tilemap.tileY((bottom + maxDrop) as Fixed);

  let best = NO_SURFACE;
  // Widened to `number`: TileFlags is `as const`, so NONE would otherwise
  // narrow this to the literal 0 and reject every real flag word.
  let bestFlags: number = TileFlags.NONE;
  let bestSlope = false;

  for (let tx = tx0; tx <= tx1; tx++) {
    // Portion of the actor's footprint that lies within this column. Sampling
    // the slope at both ends of that span (rather than at the actor's centre)
    // is what keeps a wide actor from sinking into a slope: a 24 px-wide body
    // on a 1:1 slope has its corners a full 12 px apart in surface height.
    const colLeft = Tilemap.tileLeft(tx);
    const colRight = (colLeft + TILE) as Fixed;
    const spanLeft = (left > colLeft ? left : colLeft) as Fixed;
    const spanRight = (right < colRight ? right : colRight) as Fixed;

    for (let ty = ty0; ty <= ty1; ty++) {
      const flags = map.flagsAt(tx, ty);
      const shape = map.shapeAt(tx, ty);
      const tileTop = Tilemap.tileTop(ty);

      let surface = NO_SURFACE;
      let isSlopeSurface = false;

      if (hasAny(flags, TileFlags.SOLID)) {
        if (isSlope(shape)) {
          // A linear surface reaches its extreme at a span endpoint, so
          // sampling both ends is exact, no need to walk the interior.
          const a = slopeSurfaceY(shape, tileTop, (spanLeft - colLeft) as Fixed);
          const b = slopeSurfaceY(shape, tileTop, (spanRight - colLeft) as Fixed);
          surface = (a < b ? a : b) as Fixed;
          isSlopeSurface = true;
        } else {
          surface = tileTop;
        }
      } else if (hasAny(flags, TileFlags.ONE_WAY) && !dropThrough) {
        // THE semisolid rule. The actor must have been at or above this
        // surface at the start of the tick. Testing only the current position
        // is the classic bug: walk into the side of a platform and you get
        // teleported on top of it, and you can never jump up through one.
        if (prevBottom <= tileTop) surface = tileTop;
      }

      // Keep the highest candidate. Note this deliberately accepts a surface
      // ABOVE the feet: after a tick of movement the actor has usually already
      // passed through the surface it should land on, and rejecting those is
      // what makes an actor sink through the floor. The scan starts at the row
      // containing the feet, so the upward correction can never exceed one tile.
      if (surface !== NO_SURFACE && surface < best) {
        best = surface;
        bestFlags = flags;
        bestSlope = isSlopeSurface;
      }
    }
  }

  return { y: best, flags: bestFlags, slope: bestSlope };
}

// ---------------------------------------------------------------------------
// Axis resolution
// ---------------------------------------------------------------------------

/** Move on X and push out of solid tiles. Slopes do not block horizontally. */
function resolveX(map: Tilemap, a: Actor, dx: Fixed, out: MoveResult): void {
  if (dx === 0) return;
  a.x = (a.x + dx) as Fixed;

  const ty0 = Tilemap.tileY((a.y - a.halfH) as Fixed);
  const ty1 = Tilemap.tileYExclusive((a.y + a.halfH) as Fixed);

  if (dx > 0) {
    const tx = Tilemap.tileXExclusive((a.x + a.halfW) as Fixed);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (map.isSolid(tx, ty) && !isSlope(map.shapeAt(tx, ty))) {
        // Snap to the tile edge rather than reverting to the previous position.
        // Reverting is what produces the "floating above the floor" artifact:
        // the actor repeatedly steps into the wall and is put back, never
        // settling flush against it.
        a.x = (Tilemap.tileLeft(tx) - a.halfW) as Fixed;
        a.vx = 0 as Fixed;
        out.hitWallRight = true;
        return;
      }
    }
  } else {
    const tx = Tilemap.tileX((a.x - a.halfW) as Fixed);
    for (let ty = ty0; ty <= ty1; ty++) {
      if (map.isSolid(tx, ty) && !isSlope(map.shapeAt(tx, ty))) {
        a.x = (Tilemap.tileLeft(tx) + TILE + a.halfW) as Fixed;
        a.vx = 0 as Fixed;
        out.hitWallLeft = true;
        return;
      }
    }
  }
}

/** Move on Y, land on floors and stop against ceilings. */
function resolveY(map: Tilemap, a: Actor, dy: Fixed, out: MoveResult): void {
  a.y = (a.y + dy) as Fixed;

  if (dy < 0) {
    // Rising: only full solids stop us. Semisolids and slopes are passable
    // from below, which is what makes a platform enterable from underneath.
    const ty = Tilemap.tileY((a.y - a.halfH) as Fixed);
    const tx0 = Tilemap.tileX((a.x - a.halfW) as Fixed);
    const tx1 = Tilemap.tileXExclusive((a.x + a.halfW) as Fixed);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (map.isSolid(tx, ty) && !isSlope(map.shapeAt(tx, ty))) {
        a.y = (Tilemap.tileTop(ty) + TILE + a.halfH) as Fixed;
        a.vy = 0 as Fixed;
        out.hitCeiling = true;
        return;
      }
    }
    return;
  }

  // Falling or resting: look for a floor within the distance just travelled,
  // plus enough slack to stay attached while running downhill.
  const bottom = (a.y + a.halfH) as Fixed;
  const reach = (dy + SLOPE_SNAP_DOWN) as Fixed;
  const found = floorSurfaceUnder(map, a.x, bottom, a.halfW, a.prevBottom, reach, a.dropThrough);

  if (found.y === NO_SURFACE) return;

  const reached = bottom >= found.y;

  // The surface may still be below the feet: the actor ran off the crest of a
  // slope, or crossed a seam where a slope meets flat ground. Pull it back down
  // if it was already grounded and the drop is small.
  //
  // The discriminator is the DISTANCE, not whether the surface is a slope.
  // Requiring a slope looks right but fails at exactly the seam it is meant to
  // handle: where a slope meets the floor, both surfaces are candidates at the
  // same height and the flat one wins the tie, so the cling silently switches
  // off for the two ticks either side of the join. Distance alone is also the
  // correct rule for small steps, and a real ledge (a full tile, 16px) is
  // safely beyond SLOPE_SNAP_DOWN, so walking off one still drops you.
  const clingsToGround =
    (a.wasGrounded ?? false) && found.y - bottom <= SLOPE_SNAP_DOWN;

  if (!reached && !clingsToGround) return;

  commitFloor(map, a, found, out);
}

/**
 * Place the actor on a floor surface, but only if it fits there.
 *
 * THE HEADROOM CHECK IS NOT OPTIONAL, and it belongs here rather than only in
 * the slope-snap path. Landing on a rising slope moves the actor UP, so a slope
 * running beneath a low ceiling can lift it head-first into solid tiles, where
 * the crush rule then kills it instantly, with no animation and no visible
 * cause. A slope under an overhang is an ordinary thing to build, so this has
 * to be handled rather than treated as a degenerate case.
 *
 * When it does not fit, the actor keeps its position, stops moving
 * horizontally, and stands at the foot of the pinch. "You don't fit" is
 * something a player can see and understand; a mystery death is not.
 */
function commitFloor(
  map: Tilemap,
  a: Actor,
  found: { y: Fixed; flags: number; slope: boolean },
  out: MoveResult,
): void {
  const candidateY = (found.y - a.halfH) as Fixed;

  // Only an upward correction can pinch the head; a downward one cannot.
  if (candidateY < a.y && overlapsSolid(map, a.x, candidateY, a.halfW, a.halfH)) {
    a.vx = 0 as Fixed;
    return;
  }

  a.y = candidateY;
  a.vy = 0 as Fixed;
  out.grounded = true;
  out.groundFlags = found.flags;
  out.onSlope = found.slope;
}

/**
 * Lift an actor onto a slope surface that has risen above its feet.
 *
 * `resolveY` only ever looks downward, so an actor walking along flat ground
 * onto a rising slope never notices the surface climbing over it and would
 * simply walk along underneath. This is the pass that catches that, and it must
 * run whether or not the actor is already grounded: being grounded on the tile
 * below IS the case it exists for.
 */
function snapUpSlope(map: Tilemap, a: Actor, out: MoveResult): void {
  // Only while descending or level. An actor on the way up is jumping past the
  // slope, not walking onto it, and must not be yanked onto its surface.
  if (a.vy < 0) return;

  const bottom = (a.y + a.halfH) as Fixed;
  const found = floorSurfaceUnder(
    map,
    a.x,
    (bottom - SLOPE_SNAP_UP) as Fixed,
    a.halfW,
    a.prevBottom,
    SLOPE_SNAP_UP,
    a.dropThrough,
  );
  if (found.y === NO_SURFACE || !found.slope) return;
  if (found.y >= bottom) return; // surface is not above the feet, nothing to do

  commitFloor(map, a, found, out);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Push a box horizontally out of any solid tile it is already inside.
 *
 * Normal movement can never embed an actor, because every step resolves as it
 * goes. Being CARRIED can: a moving platform translates its rider's position
 * directly, and if it carries it into a wall there was no movement of the
 * actor's own for the resolver to check. Without this, a lift quietly pushes
 * the player through solid geometry.
 *
 * Pushes toward whichever side is nearer, so an actor squeezed from the left
 * exits left. Returns the corrected x.
 */
export function depenetrateX(
  map: Tilemap,
  x: Fixed,
  y: Fixed,
  halfW: Fixed,
  halfH: Fixed,
): Fixed {
  const ty0 = Tilemap.tileY((y - halfH) as Fixed);
  const ty1 = Tilemap.tileYExclusive((y + halfH) as Fixed);
  const tx0 = Tilemap.tileX((x - halfW) as Fixed);
  const tx1 = Tilemap.tileXExclusive((x + halfW) as Fixed);

  for (let tx = tx0; tx <= tx1; tx++) {
    for (let ty = ty0; ty <= ty1; ty++) {
      if (!map.isSolid(tx, ty) || isSlope(map.shapeAt(tx, ty))) continue;
      const tileLeft = Tilemap.tileLeft(tx);
      const tileRight = (tileLeft + TILE) as Fixed;
      const pushRight = tileRight + halfW - x; // move right, out of this tile
      const pushLeft = x - (tileLeft - halfW); // move left, out of this tile
      return (pushRight < pushLeft ? x + pushRight : x - pushLeft) as Fixed;
    }
  }
  return x;
}

/**
 * Advance an actor by its velocity, resolving against the tilemap.
 *
 * Movement is split into sub-steps small enough that no single step can cross a
 * whole tile. At normal speeds this is always one step and costs nothing; it
 * exists so that springs, pipe ejection and debug fly cannot phase through a
 * wall. Sub-stepping is used rather than a swept test because it keeps the
 * resolver (and therefore the game's feel) identical at every speed.
 */
export function moveActor(map: Tilemap, a: Actor): MoveResult {
  const out: MoveResult = {
    grounded: false,
    hitCeiling: false,
    hitWallLeft: false,
    hitWallRight: false,
    onSlope: false,
    groundFlags: TileFlags.NONE,
  };

  const maxComponent = Math.max(Math.abs(a.vx), Math.abs(a.vy));
  const stepLimit = TILE - ONE; // strictly less than one tile per sub-step
  const steps = Math.max(1, Math.ceil(maxComponent / stepLimit));

  let remainingX = a.vx;
  let remainingY = a.vy;

  for (let i = 0; i < steps; i++) {
    // Recompute the slice from what is left each time rather than precomputing
    // vx/steps: velocity can be zeroed by a collision mid-way, and the actor
    // must stop immediately instead of continuing with a stale slice.
    const stepsLeft = steps - i;
    const dx = Math.trunc(remainingX / stepsLeft) as Fixed;
    const dy = Math.trunc(remainingY / stepsLeft) as Fixed;
    remainingX = (remainingX - dx) as Fixed;
    remainingY = (remainingY - dy) as Fixed;

    resolveX(map, a, dx, out);
    if (a.vx === 0) remainingX = 0 as Fixed;

    resolveY(map, a, dy, out);
    if (a.vy === 0) remainingY = 0 as Fixed;

    // Runs whether or not resolveY already found a floor. Walking off flat
    // ground onto a rising slope IS the grounded case: the actor is standing
    // happily on the tile below while the slope surface climbs above its feet,
    // and resolveY never looks upward. Gating this on `!grounded` leaves the
    // actor walking along the floor *underneath* the slope.
    snapUpSlope(map, a, out);
  }

  return out;
}

export { NO_SURFACE, Shape };
