import { ONE, type Fixed } from "../math/fixed";
import { MAX_ENTITIES } from "../core/constants";
import { EntityFlags, hasAny } from "../core/flags";
import { NULL_ENTITY, type EntityId } from "../core/ids";
import type { World } from "../core/world";
import type { Tilemap } from "./tilemap";
import { depenetrateX, type Actor, type MoveResult } from "./resolve";

/**
 * MOVING SOLIDS: lifts, snake blocks, seesaws, tracked platforms.
 *
 * These are entities, not tiles, so the tilemap resolver knows nothing about
 * them. Without a dedicated pass an actor falls straight through every one of
 * them, which silently removes an entire category of level design.
 *
 * ---------------------------------------------------------------------------
 * ORDER MATTERS, AND IT IS THIS:
 * ---------------------------------------------------------------------------
 *   1. Platforms integrate.        (their own movement, recorded as a delta)
 *   2. Riders are TRANSLATED.      (carried along by the platform's delta)
 *   3. Actors integrate.           (gravity, input, their own velocity)
 *   4. Actors resolve v. tiles.    (walls and floors win over platforms)
 *   5. Actors resolve v. platforms. (this file; establishes `ground` for next tick)
 *
 * Step 2 adds the platform's delta to the rider's POSITION, never to its
 * velocity. Adding to velocity makes the rider integrate the same motion a
 * second time in step 3, so it accelerates off the front of the platform, the
 * single most common way this gets written wrong.
 *
 * Step 4 before step 5 is what makes a wall beat a platform: if a lift pushes
 * an actor into a wall, the actor is stopped by the wall rather than smeared
 * through it.
 */

/** Platform tops are grabbed from this far below the feet, mirroring tile snap. */
const PLATFORM_SNAP: Fixed = (4 * ONE) as Fixed;

interface Aabb {
  left: Fixed;
  right: Fixed;
  top: Fixed;
  bottom: Fixed;
}

function aabbOf(world: World, i: number): Aabb {
  const s = world.store;
  return {
    left: (s.x[i] - s.halfW[i]) as Fixed,
    right: (s.x[i] + s.halfW[i]) as Fixed,
    top: (s.y[i] - s.halfH[i]) as Fixed,
    bottom: (s.y[i] + s.halfH[i]) as Fixed,
  };
}

/** Where the platform's top edge was at the start of this tick. */
function prevTopOf(world: World, i: number): Fixed {
  return (world.store.prevY[i] - world.store.halfH[i]) as Fixed;
}

/**
 * Carry every rider along with the platform it is standing on.
 *
 * Runs after platforms have moved and before actors integrate. `ground` was
 * established at the end of the previous tick, which is why this can be a
 * simple lookup rather than a search.
 */
export function carryRiders(world: World, map: Tilemap): void {
  const s = world.store;
  for (let i = 0; i < MAX_ENTITIES; i++) {
    if (!world.isActive(i)) continue;
    const platformId = s.ground[i] as EntityId;
    if (platformId === NULL_ENTITY) continue;

    const p = world.resolve(platformId);
    if (p < 0) {
      // The platform was destroyed underneath us. Drop the stale reference
      // rather than carrying a ghost.
      s.ground[i] = NULL_ENTITY;
      continue;
    }

    // Position, not velocity. See the header note.
    s.x[i] = (s.x[i] + (s.x[p] - s.prevX[p])) as Fixed;
    s.y[i] = (s.y[i] + (s.y[p] - s.prevY[p])) as Fixed;

    // The carry moved the rider without any of ITS OWN velocity, so the normal
    // resolver never sees it and a platform can shove a rider into a wall.
    // Push back out here: the wall wins over the platform.
    s.x[i] = depenetrateX(map, s.x[i] as Fixed, s.y[i] as Fixed, s.halfW[i] as Fixed, s.halfH[i] as Fixed);
  }
}

/**
 * Land an actor on any moving solid it has reached, and record which one.
 *
 * Platforms are treated as one-way surfaces: solid from above, passable from
 * below and from the sides. That matches how lifts and snake blocks behave, and
 * it means an actor jumping up through one is not stopped dead by a platform
 * that is visually thin.
 *
 * The `prevBottom <= prevTop` test is the same rule semisolid tiles use, with
 * one important difference: the platform's PREVIOUS top edge is what matters,
 * not its current one. A lift rising into an actor would otherwise fail the
 * test (the actor never descended through the surface, the surface came up to
 * meet it) and the actor would be left behind as the lift passed through.
 */
export function collideWithMovingSolids(
  world: World,
  actorIndex: number,
  a: Actor,
  out: MoveResult,
): void {
  const s = world.store;

  // An actor moving upward cannot land on a one-way surface: it is passing
  // through from below. Without this guard the SNAP tolerance below reaches up
  // and catches a rising jump a few pixels short of the platform, so jumping
  // up through a lift silently fails.
  if (a.vy < 0) {
    s.ground[actorIndex] = NULL_ENTITY;
    return;
  }

  let bestTop: Fixed | null = null;
  let bestPlatform = NULL_ENTITY as EntityId;

  const left = (a.x - a.halfW) as Fixed;
  const right = (a.x + a.halfW) as Fixed;
  const bottom = (a.y + a.halfH) as Fixed;

  for (let p = 0; p < MAX_ENTITIES; p++) {
    if (p === actorIndex || !world.isActive(p)) continue;
    if (!hasAny(s.flags[p], EntityFlags.MOVING_SOLID)) continue;

    const box = aabbOf(world, p);
    // Horizontal overlap. Exclusive at the edges so merely touching the side of
    // a platform does not count as standing on it.
    if (right <= box.left || left >= box.right) continue;

    const prevTop = prevTopOf(world, p);
    // Must have been at or above the surface before either of us moved.
    if (a.prevBottom > prevTop + ONE) continue;
    // Must have reached it now (with a little slack so a descending platform
    // does not shake the rider loose every other tick).
    if (bottom < box.top - PLATFORM_SNAP) continue;
    // And must not have already passed clean through it.
    if (a.y > box.top) continue;

    if (bestTop === null || box.top < bestTop) {
      bestTop = box.top;
      bestPlatform = world.idAt(p);
    }
  }

  if (bestTop === null) {
    // No platform under us, so clear the reference unconditionally, including
    // when the TILEMAP grounded us. Stepping off a lift onto solid floor is
    // precisely when the link must be dropped: leaving it set means
    // `carryRiders` keeps applying the departed lift's motion every tick, and
    // the actor gets towed along the ground and pushed through walls.
    s.ground[actorIndex] = NULL_ENTITY;
    return;
  }

  a.y = (bestTop - a.halfH) as Fixed;
  if (a.vy > 0) a.vy = 0 as Fixed;
  out.grounded = true;
  s.ground[actorIndex] = bestPlatform;
}

/**
 * Clear a rider's platform reference.
 *
 * Called when the actor jumps or is otherwise launched, so it is not dragged
 * along by a platform it has left.
 */
export function detachFromPlatform(world: World, actorIndex: number): void {
  world.store.ground[actorIndex] = NULL_ENTITY;
}
