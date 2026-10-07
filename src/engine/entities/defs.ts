import { fromPx, raw, type Fixed } from "../math/fixed";
import { EntityFlags, combine } from "../core/flags";

/**
 * ENTITY DEFINITIONS.
 *
 * Behaviour is composed from named traits declared in DATA, not written as a
 * class per enemy. Adding an enemy should be adding a row here plus, at most,
 * one new trait, and if a part needs bespoke movement code that nothing else
 * could reuse, that is the signal a trait is missing rather than a licence to
 * special-case it.
 *
 * The pay-off is that the whole roster stays legible at a glance, and a future
 * session can add a "turns at ledges" enemy without reading a single line of
 * the movement code.
 */

export type Behavior =
  /** Nothing. Coins, gems sitting still. */
  | "static"
  /** Walks forward, reverses at walls. Falls off ledges. */
  | "walk"
  /** Walks forward, reverses at walls AND at ledges. */
  | "walkCareful"
  /** A kicked shell: fast, reverses at walls, defeats what it hits. */
  | "shell";

export type TouchResult =
  /** Hurts the player on contact. */
  | "hurt"
  /** Picked up and gone. */
  | "collect"
  /** Nothing happens. */
  | "none";

export type StompResult =
  /** Defeated outright. */
  | "defeat"
  /** Becomes a dormant shell that can then be kicked. */
  | "toShell"
  /** Cannot be stomped: stomping it hurts you instead. */
  | "reject";

export interface EntityDef {
  readonly partId: number;
  readonly halfW: Fixed;
  readonly halfH: Fixed;
  readonly behavior: Behavior;
  readonly speed: Fixed;
  readonly gravity: boolean;
  readonly onStomp: StompResult;
  readonly onTouch: TouchResult;
  /** What collecting it does. */
  readonly collect?: "coin" | "grow" | "life";
  /** Points awarded when defeated or collected. */
  readonly points: number;
  readonly color: string;
}

/**
 * Walking speed for ordinary ground enemies: 0.5 px/frame.
 *
 * Written in raw 1/4096 units because float literals are banned inside the
 * engine: a float in the sim almost always means a unit conversion was
 * skipped. 2048 units = half a pixel; a fifth of the player's run speed, which
 * is slow enough to be read and jumped over on sight.
 */
const ENEMY_WALK: Fixed = raw(2048);
/** A kicked shell travels faster than the player can run, so it outruns you. */
const SHELL_SPEED: Fixed = fromPx(3);

export const ENTITY_DEFS: readonly EntityDef[] = [
  {
    partId: 100,
    halfW: fromPx(5),
    halfH: fromPx(5),
    behavior: "static",
    speed: 0 as Fixed,
    gravity: false,
    onStomp: "reject",
    onTouch: "collect",
    collect: "coin",
    points: 100,
    color: "#ffd166",
  },
  {
    partId: 101,
    halfW: fromPx(7),
    halfH: fromPx(7),
    // A gem that sits still is easy to catch, which is the point of the
    // first power-up a young player meets.
    behavior: "static",
    speed: 0 as Fixed,
    gravity: true,
    onStomp: "reject",
    onTouch: "collect",
    collect: "grow",
    points: 1000,
    color: "#e05c4a",
  },
  {
    partId: 102,
    halfW: fromPx(7),
    halfH: fromPx(7),
    // Sits still like the power gem. An extra life that ran away would be the one
    // reward in the game a young player could fail to get by being slow, which is the
    // opposite of what an extra life is for.
    behavior: "static",
    speed: 0 as Fixed,
    gravity: true,
    onStomp: "reject",
    onTouch: "collect",
    collect: "life",
    // No score. An extra life IS the reward; adding points on top muddles what
    // just happened.
    points: 0,
    color: "#4fa35c",
  },
  {
    partId: 110,
    halfW: fromPx(7),
    halfH: fromPx(7),
    behavior: "walk",
    speed: ENEMY_WALK,
    gravity: true,
    onStomp: "defeat",
    onTouch: "hurt",
    points: 100,
    color: "#b1653a",
  },
  {
    partId: 111,
    halfW: fromPx(7),
    halfH: fromPx(8),
    // Turns at ledges, so it paces a platform instead of walking off it.
    behavior: "walkCareful",
    speed: ENEMY_WALK,
    gravity: true,
    onStomp: "toShell",
    onTouch: "hurt",
    points: 100,
    color: "#4fa35c",
  },
];

const BY_PART = new Map(ENTITY_DEFS.map((d) => [d.partId, d]));

export function entityDefFor(partId: number): EntityDef | undefined {
  return BY_PART.get(partId);
}

/** The dormant/kicked shell an entity becomes when stomped. */
export const SHELL_PART = 900;

export const SHELL_DEF: EntityDef = {
  partId: SHELL_PART,
  halfW: fromPx(7),
  halfH: fromPx(6),
  behavior: "shell",
  speed: SHELL_SPEED,
  gravity: true,
  onStomp: "defeat",
  onTouch: "hurt",
  points: 200,
  color: "#3d7d47",
};

export function anyDefFor(partId: number): EntityDef | undefined {
  return partId === SHELL_PART ? SHELL_DEF : BY_PART.get(partId);
}

/** Runtime flags every spawned entity starts with. */
export function flagsFor(def: EntityDef): number {
  return combine(
    EntityFlags.TILE_COLLIDE,
    def.gravity ? EntityFlags.GRAVITY : EntityFlags.NONE,
  );
}

/** Entity state machine slots. Kept tiny and shared across behaviours. */
export const EntityState = {
  ACTIVE: 0,
  /** A shell sitting still, waiting to be kicked. */
  DORMANT: 1,
  /** Flattened/defeated, playing out a short death animation. */
  DYING: 2,
} as const;

/** Frames a defeated enemy stays visible before it is removed. */
export const DEATH_FRAMES = 24;
