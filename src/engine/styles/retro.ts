import { ONE, raw, type Fixed } from "../math/fixed";

/**
 * THE "RETRO" STYLE: physics tables.
 *
 * These numbers are the entire reason the game feels right, so they live in
 * one file, are never duplicated, and are locked by tests that assert human-
 * meaningful outcomes (a standing jump clears 4 tiles, a running jump clears 5).
 *
 * ---------------------------------------------------------------------------
 * ON THESE NUMBERS
 * ---------------------------------------------------------------------------
 * These values follow published research into classic NES-era platformer
 * movement. They describe how a game feels, which is a set of facts, and are
 * written down here as plain data. No third-party code or data is included,
 * and all art and audio in the project is original and generated in code.
 *
 * ---------------------------------------------------------------------------
 * UNITS
 * ---------------------------------------------------------------------------
 * Everything is Fixed (1/4096 px) per frame, at 60 ticks/second, 16 px/tile.
 *
 * The published research expresses speeds in sixteenths of a pixel with a
 * 1/256 sub-fraction, which gives 1/4096 px of effective resolution. That is
 * exactly why this scale was chosen (see math/fixed.ts). The published figures
 * therefore convert with no arithmetic at all: every constant below is a whole
 * number of 1/4096 px.
 */

/** Convert a whole-pixels-per-frame figure to Fixed. Integer inputs only. */
const pxPerFrame = (px: number): Fixed => raw(px * ONE);
/** Convert an eighth-of-a-pixel figure to Fixed, avoiding float literals. */
const eighths = (n: number): Fixed => raw((n * ONE) / 8);

// ---------------------------------------------------------------------------
// Horizontal speed caps
// ---------------------------------------------------------------------------
// Acceleration is applied BEFORE the clamp, so the attainable maximum is one
// acceleration step past these values (2.5625 rather than 2.5). The ordering
// matters: it is the difference between clearing a gap and not.

/** 10240 = 2.5 px/frame. Requires the run button (see RUN_GRACE). */
export const MAX_RUN: Fixed = eighths(20);
/** 6144 = 1.5 px/frame. */
export const MAX_WALK: Fixed = eighths(12);
/** 4096 = 1.0 px/frame. Underwater, and airborne below run speed. */
export const MAX_WATER: Fixed = pxPerFrame(1);

// ---------------------------------------------------------------------------
// Acceleration and friction
// ---------------------------------------------------------------------------
// Each value is added to the speed every frame, so one unit is 1/4096 px per
// frame squared, our Fixed unit exactly.

/** 228 = about 0.0557 px/frame^2. Applied while the run button is held. */
export const ACCEL_RUN: Fixed = raw(228);
/** 152 = about 0.0371 px/frame^2. Applied while walking. */
export const ACCEL_WALK: Fixed = raw(152);
/** 208 = about 0.0508 px/frame^2. Applied when no direction is held, on the ground. */
export const DECEL_RELEASE: Fixed = raw(208);

/**
 * Skidding: the ACTIVE friction value, doubled.
 *
 * Applied when the character faces opposite to its direction of travel. It
 * doubles whichever friction value is currently selected, not one fixed
 * constant. At walking speed that is 2x152; past roughly 2 px/frame it is
 * 2x208, which is the 416 below.
 *
 * Since skidding only matters when you are actually moving fast enough to
 * skid, the high-speed value is the one worth naming. It is what makes a hard
 * direction change feel like a deliberate skid rather than a slow drift.
 */
export const DECEL_SKID: Fixed = raw(416);

/**
 * THERE IS NO AIR FRICTION.
 *
 * Friction is applied unconditionally on the ground but only when a direction
 * is actually held in the air. Release the d-pad mid-jump and horizontal speed
 * is preserved exactly until landing.
 *
 * This is not an oversight to be "fixed": it is a defining feel characteristic
 * and level designs depend on it. Applying air drag would feel mushy in a way
 * players notice immediately without being able to name.
 */
export const AIR_FRICTION: Fixed = raw(0);

/**
 * Frames the run cap persists after the run button is released.
 *
 * A 10-frame timer is refreshed while grounded, with the run button
 * held, and moving in the direction pressed. While it is non-zero the higher
 * cap applies. This is why run speed survives a brief button release, and why
 * speed effectively locks once airborne.
 */
export const RUN_GRACE_FRAMES = 10;

// ---------------------------------------------------------------------------
// Jump
// ---------------------------------------------------------------------------

/**
 * Jump tiers, selected by |vx| AT THE INSTANT OF TAKEOFF.
 *
 * Both the launch velocity AND the two gravity values change with speed. A
 * single fixed jump velocity could not support the design language of
 * "run to clear this gap", because running would change only the horizontal
 * distance and not the arc.
 *
 * `minSpeed` holds the comparison thresholds (0.5625, 1, 1.5625 and 1.75
 * px/frame) as Fixed. Scan from the top down and take
 * the first tier the speed reaches.
 */
export interface JumpTier {
  /** Minimum |vx| for this tier. */
  readonly minSpeed: Fixed;
  /** Launch velocity. Negative is upward (+Y is down). */
  readonly launch: Fixed;
  /** Gravity while rising with the jump button still held. */
  readonly gravityRise: Fixed;
  /** Gravity once the button is released or the rise ends. */
  readonly gravityFall: Fixed;
}

export const JUMP_TIERS: readonly JumpTier[] = [
  // |vx| >= 7168 (1.75 px/f), full run. Launch -20480 (-5 px/f).
  // Gravity 640 (0.156 px/f^2) rising, 2304 (0.5625 px/f^2) falling.
  { minSpeed: eighths(14), launch: pxPerFrame(-5), gravityRise: raw(640), gravityFall: raw(2304) },
  // |vx| >= 6400 (1.5625 px/f). Same tier values as above.
  { minSpeed: raw(6400), launch: pxPerFrame(-5), gravityRise: raw(640), gravityFall: raw(2304) },
  // |vx| >= 4096 (1.0 px/f), the floatiest tier. Launch -16384 (-4 px/f).
  // Gravity 480 (0.117 px/f^2) rising, 1536 (0.375 px/f^2) falling.
  { minSpeed: pxPerFrame(1), launch: pxPerFrame(-4), gravityRise: raw(480), gravityFall: raw(1536) },
  // |vx| >= 2304 (0.5625 px/f). Launch -16384 (-4 px/f).
  // Gravity 512 (0.125 px/f^2) rising, 1792 (0.4375 px/f^2) falling.
  { minSpeed: raw(2304), launch: pxPerFrame(-4), gravityRise: raw(512), gravityFall: raw(1792) },
  // Standing. Same as the tier above.
  { minSpeed: raw(0), launch: pxPerFrame(-4), gravityRise: raw(512), gravityFall: raw(1792) },
];

/** Pick the jump tier for a horizontal speed. `absVx` must be non-negative. */
export function jumpTierFor(absVx: Fixed): JumpTier {
  for (const tier of JUMP_TIERS) {
    if (absVx >= tier.minSpeed) return tier;
  }
  return JUMP_TIERS[JUMP_TIERS.length - 1];
}

/**
 * Terminal fall speed: 4 px/frame.
 *
 * The published clamp is applied only once the sub-fraction has also passed
 * half a unit, so a falling character momentarily touches 4.5 px/frame before
 * being pinned to 4.0. We clamp at 4.0 (16384), which is what the character
 * actually sustains.
 */
export const MAX_FALL: Fixed = pxPerFrame(4);

// ---------------------------------------------------------------------------
// Modern accommodations
// ---------------------------------------------------------------------------

/**
 * Coyote time and jump buffering: frames of grace either side of a jump.
 *
 * Strict retro-style jumping needs a rising edge on the button AND the
 * character to be grounded on that exact same frame: one frame off a ledge and
 * the input is dropped.
 *
 * That feels crisp, and it is also brutal for a young player. These default to
 * the modern values; setting both to 0 gives the strict behaviour, and the
 * setting is exposed so it can be A/B'd.
 *
 * Note the interaction with JUMP_TIERS: when a coyote-time jump fires, the tier
 * must be chosen from the speed at the JUMP frame, not the frame the character
 * left the ground, or fast ledge-jumps get the wrong arc.
 */
export const COYOTE_FRAMES = 5;
export const JUMP_BUFFER_FRAMES = 5;

/**
 * Low-friction surfaces (ice, and every surface in a night snow theme).
 *
 * Acceleration and deceleration are both scaled by this fraction, so the
 * character takes noticeably longer to get moving AND to stop. Applies to the
 * PLAYER ONLY: enemies and carried objects are unaffected, which is what makes
 * an ice level a test of the player's control rather than a physics free-for-all.
 */
export const ICE_FRICTION_NUMERATOR = 1;
export const ICE_FRICTION_DENOMINATOR = 4;
