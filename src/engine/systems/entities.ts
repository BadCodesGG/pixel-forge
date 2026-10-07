import { abs, fromPx, fromTiles, type Fixed } from "../math/fixed";
import { DESPAWN_MARGIN, LOGICAL_H, LOGICAL_W, MAX_ENTITIES, TILE } from "../core/constants";
import { EntityFlags, TileFlags, hasAny, setFlags } from "../core/flags";
import type { World } from "../core/world";
import type { Tilemap } from "../collision/tilemap";
import { moveActor, type Actor } from "../collision/resolve";
import type { CompiledArea } from "../level/compile";
import {
  DEATH_FRAMES,
  EntityState,
  SHELL_DEF,
  SHELL_PART,
  anyDefFor,
  entityDefFor,
  flagsFor,
} from "../entities/defs";
import { MAX_FALL, JUMP_TIERS } from "../styles/retro";
import type { PlayerState } from "./player";

/**
 * ENTITY STREAMING AND BEHAVIOUR.
 *
 * Entities exist only while they are near the camera. That is not just an
 * optimisation: it is a behaviour levels are designed around: walking back and
 * forth to reset an enemy is a technique, and getting the despawn distance
 * wrong silently changes what a level plays like.
 */

const GRAVITY: Fixed = JUMP_TIERS[0].gravityFall;

/** How far ahead of the camera an entity wakes up. */
const SPAWN_MARGIN: Fixed = fromPx(32);

export interface EntityContext {
  world: World;
  map: Tilemap;
  area: CompiledArea;
  cameraX: Fixed;
  cameraY: Fixed;
  /**
   * Spawn records that must never come back: collected coins, defeated enemies.
   *
   * This is the distinction between the two ways an entity can leave the world,
   * and getting it wrong is very visible. Going OFF-CAMERA is temporary: walk
   * back and the enemy is there again, which levels are designed around.
   * Being COLLECTED OR DEFEATED is permanent. Without this set, a coin you
   * picked up reappears the instant the streamer next runs, and can be farmed
   * forever by standing still.
   */
  consumed: Uint8Array;
}

/**
 * Wake entities the camera is approaching, and retire ones it has left behind.
 *
 * `spawnIndex` records which row of the compiled table an entity came from, so
 * a single object can never be spawned twice while it is already alive.
 */
export function streamEntities(ctx: EntityContext): void {
  const { world, area } = ctx;
  const left = (ctx.cameraX - SPAWN_MARGIN) as Fixed;
  const right = (ctx.cameraX + fromPx(LOGICAL_W) + SPAWN_MARGIN) as Fixed;

  const alive = new Set<number>();
  for (let i = 0; i < MAX_ENTITIES; i++) {
    if (world.isActive(i)) alive.add(world.store.spawnIndex[i]);
  }

  for (let s = 0; s < area.spawns.length; s++) {
    if (alive.has(s) || ctx.consumed[s] === 1) continue;
    const record = area.spawns[s];
    const x = fromTiles(record.tx);
    if (x < left || x > right) continue;

    const def = entityDefFor(record.partId);
    if (!def) continue;

    world.spawn({
      kind: record.partId,
      // Centre horizontally in its tile, and sit ON the tile rather than
      // inside it: an enemy placed on the floor should stand on the floor.
      //
      // A stacked object starts lifted clear of everything under it, so the
      // pile is already a pile on the first frame rather than resolving itself
      // in front of the player. `resolveEntityStacking` then holds it together.
      x: (x + TILE / 2) as Fixed,
      y: (fromTiles(record.ty) + TILE - def.halfH - record.stack * STACK_LIFT) as Fixed,
      halfW: def.halfW,
      halfH: def.halfH,
      flags: flagsFor(def),
      face: -1,
      spawnIndex: s,
    });
  }

  // Retire anything the camera has left well behind.
  const cullLeft = (ctx.cameraX - DESPAWN_MARGIN) as Fixed;
  const cullRight = (ctx.cameraX + fromPx(LOGICAL_W) + DESPAWN_MARGIN) as Fixed;
  const cullBottom = (ctx.cameraY + fromPx(LOGICAL_H) + fromTiles(6)) as Fixed;

  for (let i = 0; i < MAX_ENTITIES; i++) {
    if (!world.isActive(i)) continue;
    if (hasAny(world.store.flags[i], EntityFlags.PERSISTENT)) continue;
    const x = world.store.x[i] as Fixed;
    const y = world.store.y[i] as Fixed;
    if (x < cullLeft || x > cullRight || y > cullBottom) {
      world.despawn(world.idAt(i));
    }
  }
}

/**
 * How far above its cell a stacked object starts, in fixed-point.
 *
 * One tile. Every stackable entity is under a tile tall, so a rider always
 * begins clear of the one below it whatever the two are.
 */
const STACK_LIFT = TILE;

/** How close a rider's feet must be to a surface to land on it: two pixels. */
const STACK_GRIP = fromPx(2);

/**
 * Let entities stand on each other.
 *
 * Enemies used to pass straight through one another, so a deliberately stacked
 * pair simply merged into the same square. Stacking is a real authoring move -
 * a walker riding a shell walker is a different obstacle from either alone, and
 * stomping the top one to reveal what it was standing on is the whole point.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SEPARATE PASS, AFTER ALL TILE MOVEMENT
 * ---------------------------------------------------------------------------
 * Resolving riders inside the movement loop would make the outcome depend on
 * the order entities happen to sit in the store, which is exactly the kind of
 * thing that makes a replay diverge on a different machine. Running it as one
 * pass over already-settled positions gives every entity the same view of the
 * world, and reads the same result on every run.
 *
 * Everything here is integer comparison on fixed-point positions. No floats, no
 * clock, no randomness - the determinism rules apply to this as much as to
 * anything else in the sim.
 */
export function resolveEntityStacking(ctx: EntityContext): void {
  const { world } = ctx;
  const s = world.store;

  for (let i = 0; i < MAX_ENTITIES; i++) {
    if (!world.isActive(i)) continue;
    if (s.state[i] === EntityState.DYING) continue;
    // Only something that is falling can land on something else. A rising
    // entity passing another is not standing on it.
    if (s.vy[i] < 0) continue;
    if (!hasAny(s.flags[i], EntityFlags.GRAVITY)) continue;

    const feet = (s.y[i] + s.halfH[i]) as Fixed;
    const left = (s.x[i] - s.halfW[i]) as Fixed;
    const right = (s.x[i] + s.halfW[i]) as Fixed;

    let bestTop = 0 as Fixed;
    let carrier = -1;

    for (let j = 0; j < MAX_ENTITIES; j++) {
      if (j === i || !world.isActive(j)) continue;
      if (s.state[j] === EntityState.DYING) continue;

      const jl = (s.x[j] - s.halfW[j]) as Fixed;
      const jr = (s.x[j] + s.halfW[j]) as Fixed;
      if (right <= jl || left >= jr) continue;

      const top = (s.y[j] - s.halfH[j]) as Fixed;
      // Feet must be at or just above the surface, and never below its middle -
      // otherwise an entity that has drifted inside another would be snapped up
      // on top of it, which looks like a teleport.
      if (feet < top - STACK_GRIP) continue;
      if (feet > s.y[j]) continue;
      if (carrier === -1 || top < bestTop) {
        bestTop = top;
        carrier = j;
      }
    }

    if (carrier === -1) continue;

    s.y[i] = (bestTop - s.halfH[i]) as Fixed;
    s.vy[i] = 0 as Fixed;
    s.flags[i] = setFlags(s.flags[i], EntityFlags.GROUNDED, true);
  }
}

/** Advance every entity one tick. */
export function updateEntities(ctx: EntityContext): void {
  const { world, map } = ctx;
  const s = world.store;

  for (let i = 0; i < MAX_ENTITIES; i++) {
    if (!world.isActive(i)) continue;
    const def = anyDefFor(s.kind[i]);
    if (!def) continue;

    if (s.state[i] === EntityState.DYING) {
      s.timer[i] -= 1;
      if (s.timer[i] <= 0) world.despawn(world.idAt(i));
      continue;
    }

    if (hasAny(s.flags[i], EntityFlags.GRAVITY)) {
      const next = (s.vy[i] + GRAVITY) as Fixed;
      s.vy[i] = (next > MAX_FALL ? MAX_FALL : next) as Fixed;
    }

    switch (def.behavior) {
      case "walk":
      case "walkCareful":
        s.vx[i] = (def.speed * s.face[i]) as Fixed;
        break;
      case "shell":
        // A dormant shell sits still until kicked; state carries which it is.
        s.vx[i] = s.state[i] === EntityState.DORMANT ? (0 as Fixed) : ((SHELL_DEF.speed * s.face[i]) as Fixed);
        break;
      case "static":
        break;
    }

    const actor: Actor = {
      x: s.x[i] as Fixed,
      y: s.y[i] as Fixed,
      vx: s.vx[i] as Fixed,
      vy: s.vy[i] as Fixed,
      halfW: s.halfW[i] as Fixed,
      halfH: s.halfH[i] as Fixed,
      prevBottom: (s.y[i] + s.halfH[i]) as Fixed,
      wasGrounded: hasAny(s.flags[i], EntityFlags.GROUNDED),
    };
    const result = moveActor(map, actor);

    s.x[i] = actor.x;
    s.y[i] = actor.y;
    s.vx[i] = actor.vx;
    s.vy[i] = actor.vy;
    s.flags[i] = setFlags(s.flags[i], EntityFlags.GROUNDED, result.grounded);

    // Reverse at a wall.
    if (result.hitWallLeft) s.face[i] = 1;
    else if (result.hitWallRight) s.face[i] = -1;

    // Reverse at a ledge: probe the tile ahead-and-below. This one boolean is
    // the whole difference between an enemy that paces a platform and one that
    // walks off the end of it.
    if (def.behavior === "walkCareful" && result.grounded) {
      const aheadX = (s.x[i] + s.face[i] * (s.halfW[i] + fromPx(2))) as Fixed;
      const belowY = (s.y[i] + s.halfH[i] + fromPx(2)) as Fixed;
      const tx = Math.floor(aheadX / TILE);
      const ty = Math.floor(belowY / TILE);
      if (!map.isSolid(tx, ty) && !map.isOneWay(tx, ty)) s.face[i] = (-s.face[i]) as -1 | 1;
    }
  }
}

export interface Interaction {
  /** Player stomped something. */
  stomped?: { x: Fixed; y: Fixed; points: number };
  /** Player collected something. */
  collected?: { kind: "coin" | "grow" | "life"; x: Fixed; y: Fixed; points: number };
  /** Player took a hit. */
  hurt?: boolean;
  /** Compiled spawn row to retire permanently, when this removed something. */
  spawnIndex?: number;
}

/**
 * Resolve the player against every entity.
 *
 * The stomp test is deliberately generous: descending, and overlapping the
 * upper part of the target. A strict "feet above its head" test makes stomping
 * feel unreliable in exactly the moments that matter, and a young player
 * reads unreliable as unfair.
 */
export function resolvePlayerVsEntities(
  ctx: EntityContext,
  player: PlayerState,
  onEvent: (interaction: Interaction) => void,
): void {
  const { world } = ctx;
  const s = world.store;

  const pl = (player.x - player.halfW) as Fixed;
  const pr = (player.x + player.halfW) as Fixed;
  const pt = (player.y - player.halfH) as Fixed;
  const pb = (player.y + player.halfH) as Fixed;

  for (let i = 0; i < MAX_ENTITIES; i++) {
    if (!world.isActive(i)) continue;
    if (s.state[i] === EntityState.DYING) continue;
    const def = anyDefFor(s.kind[i]);
    if (!def) continue;

    const el = (s.x[i] - s.halfW[i]) as Fixed;
    const er = (s.x[i] + s.halfW[i]) as Fixed;
    const et = (s.y[i] - s.halfH[i]) as Fixed;
    const eb = (s.y[i] + s.halfH[i]) as Fixed;
    if (pr <= el || pl >= er || pb <= et || pt >= eb) continue;

    // --- Collectibles -----------------------------------------------------
    if (def.onTouch === "collect" && def.collect) {
      onEvent({
        collected: { kind: def.collect, x: s.x[i] as Fixed, y: s.y[i] as Fixed, points: def.points },
        spawnIndex: s.spawnIndex[i],
      });
      world.despawn(world.idAt(i));
      continue;
    }

    // --- Stomping ---------------------------------------------------------
    const descending = player.vy > 0;
    const feetAboveMiddle = pb - (s.halfH[i] as Fixed) < s.y[i];
    if (descending && feetAboveMiddle && def.onStomp !== "reject") {
      if (def.onStomp === "toShell") {
        s.kind[i] = SHELL_PART;
        s.halfH[i] = SHELL_DEF.halfH;
        s.state[i] = EntityState.DORMANT;
        s.vx[i] = 0 as Fixed;
      } else {
        s.state[i] = EntityState.DYING;
        s.timer[i] = DEATH_FRAMES;
        s.vx[i] = 0 as Fixed;
      }
      onEvent({
        stomped: { x: s.x[i] as Fixed, y: s.y[i] as Fixed, points: def.points },
        // A stomped enemy is gone for good. A shell is not: it becomes a new
        // thing in the same slot, so its spawn row stays live.
        spawnIndex: def.onStomp === "defeat" ? s.spawnIndex[i] : undefined,
      });
      continue;
    }

    // --- Kicking a dormant shell -----------------------------------------
    if (s.kind[i] === SHELL_PART && s.state[i] === EntityState.DORMANT) {
      s.state[i] = EntityState.ACTIVE;
      s.face[i] = player.x < s.x[i] ? 1 : -1;
      onEvent({ stomped: { x: s.x[i] as Fixed, y: s.y[i] as Fixed, points: 0 } });
      continue;
    }

    if (def.onTouch === "hurt") onEvent({ hurt: true });
  }
}

/**
 * True if the player is TOUCHING a tile that hurts.
 *
 * The box is inflated by a pixel, which is load-bearing rather than sloppy.
 * Spike tiles are solid, so the collision resolver parks the player exactly
 * flush against one, and an exact-overlap test never fires, because flush
 * means zero overlap. Without the inflation you can walk into a wall of spikes
 * and lean on it indefinitely.
 */
export function touchingHazardTile(map: Tilemap, player: PlayerState): boolean {
  const skin = fromPx(1);
  const left = Math.floor((player.x - player.halfW - skin) / TILE);
  const right = Math.floor((player.x + player.halfW + skin - 1) / TILE);
  const top = Math.floor((player.y - player.halfH - skin) / TILE);
  const bottom = Math.floor((player.y + player.halfH + skin - 1) / TILE);
  for (let ty = top; ty <= bottom; ty++) {
    for (let tx = left; tx <= right; tx++) {
      if (hasAny(map.flagsAt(tx, ty), TileFlags.HAZARD)) return true;
    }
  }
  return false;
}

export { abs };
