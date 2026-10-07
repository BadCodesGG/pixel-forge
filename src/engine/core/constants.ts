import { TILE, TILE_PX, fromTiles, type Fixed } from "../math/fixed";

/**
 * Compile-time constants that define the shape of the world.
 *
 * These are the numbers everything else is built on, so they are all in one
 * file and are chosen deliberately rather than discovered. Changing any of them
 * is a format-level decision, not a tweak.
 */

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Simulation rate. The sim always advances in whole ticks at exactly this rate,
 * regardless of the display's refresh rate.
 *
 * 60 keeps the accumulator arithmetic clean and lines up with the common
 * display refresh. Chasing an odd rate such as 60.0988 Hz would buy nothing:
 * the 0.16% difference is imperceptible.
 */
export const TICK_HZ = 60;

/** Seconds per tick, for the host loop's accumulator. Not used inside the sim. */
export const SECONDS_PER_TICK = 1 / TICK_HZ;

// ---------------------------------------------------------------------------
// Space
// ---------------------------------------------------------------------------

export { TILE, TILE_PX };

/**
 * Internal render resolution, in pixels.
 *
 * 384x216 is exactly 24 x 13.5 tiles, a generous visible area for a
 * platformer, which matters because level designs are built around how much
 * you can see. It is also exactly 16:9 and an integer divisor of
 * 1920x1080 (x5), 1536x864 (x4) and 1152x648 (x3), so it upscales to common
 * displays with no fractional pixels.
 */
export const LOGICAL_W = 384;
export const LOGICAL_H = 216;

/** Visible tiles. The half-tile is real: the camera shows half a row. */
export const VIEW_TILES_X = LOGICAL_W / TILE_PX; // 24
export const VIEW_TILES_Y = LOGICAL_H / TILE_PX; // 13.5

// ---------------------------------------------------------------------------
// Level bounds
// ---------------------------------------------------------------------------
//
// A horizontal area is ~10 screens wide by 2 screens tall; a vertical area is
// 2 screens wide and much taller. Both axes stay under 256 so a tile coordinate
// fits in one byte on the wire.

export const AREA_MAX_W = 240;
export const AREA_H = 27;
export const AREA_VERT_W = 48;
export const AREA_VERT_MAX_H = 168;

/** Hard ceiling on either axis: the wire format stores tile coords as u8. */
export const AREA_AXIS_LIMIT = 256;

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

/**
 * Maximum entities alive at once.
 *
 * Everything is preallocated to this size at boot so the sim never allocates
 * mid-frame: allocation is the real enemy in a 60Hz loop, because GC pauses
 * surface to the player as dropped frames.
 *
 * The authoring limits are well under this (100 actors + 100 power-ups + 100
 * projectiles + 50 loose coins), leaving room for transient effects.
 */
export const MAX_ENTITIES = 512;

/**
 * Per-entity scratch integers available to composed traits.
 *
 * A part is built by composing traits (walker + stompable + periodic + ...),
 * and several of them need private mutable state (a countdown, a phase, a
 * remembered target). Giving them all one shared `timer` field is the bug that
 * makes a stomped enemy's flatten countdown clobber a burner's phase, so each
 * trait is assigned its own disjoint slots at boot instead. See parts/compose.
 *
 * Eight is enough for the deepest real composition (~5 traits, 1-2 slots each)
 * with margin; `compose()` throws at module init if a part needs more, which
 * fails loudly at startup rather than intermittently at runtime.
 */
export const SCRATCH_SLOTS = 8;

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

/**
 * How far outside the camera an entity may travel before it despawns.
 *
 * Level designs depend on this exact behaviour: makers deliberately cycle
 * enemies off-camera and back to reset them. Too generous and those setups
 * stop working; too tight and enemies vanish in view.
 */
export const DESPAWN_MARGIN_TILES = 4;
export const DESPAWN_MARGIN: Fixed = fromTiles(DESPAWN_MARGIN_TILES);
