/**
 * FIXED-POINT ARITHMETIC: the numeric foundation of the simulation.
 *
 * Every position, velocity and acceleration in the sim is a `Fixed`: an integer
 * count of 1/4096 of a pixel. No floats, anywhere, ever.
 *
 * ---------------------------------------------------------------------------
 * WHY 1/4096
 * ---------------------------------------------------------------------------
 * The published research behind the retro movement style expresses speeds in
 * 1/16 px units with a 1/256 sub-fraction, an effective resolution of 1/4096
 * px. Choosing that denominator means every constant lands on an exact integer
 * with zero rounding:
 *
 *     running acceleration  = 228   (about 0.0557 px/frame^2)
 *     walking acceleration  = 152   (about 0.0371 px/frame^2)
 *     max run speed         = 10240 (2.5 px/frame)
 *
 * A coarser scale (1/256) would turn those into fractions; a finer one (1/65536)
 * would multiply them by 16 for no gain and burn headroom.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT int32 / WHY NO BITWISE OPERATORS
 * ---------------------------------------------------------------------------
 * The obvious implementation of a fixed-point multiply is `(a * b) >> 12`.
 * It is wrong here, and it fails silently.
 *
 * JavaScript's bitwise operators coerce their operands to int32 first. A slope
 * interpolation multiplies two tile-scale values: 65536 * 65536 = 4.29e9, which
 * is already past int32's 2.147e9 ceiling. The shift wraps, and the result is
 * not "slightly off"; it is a different number with a different sign. A player
 * standing on a slope at x=200 tiles gets teleported through the floor, and
 * nothing in the type system objects.
 *
 * So: `Fixed` is a plain JS number that happens to always be an integer.
 * Doubles hold integers exactly up to 2^53, which is nine million times more
 * headroom than we need, and `Math.floor(a * b / ONE)` is exact for every
 * product the sim can produce. `no-bitwise` is an error inside src/engine.
 *
 * ---------------------------------------------------------------------------
 * TWO ROUNDING CONVENTIONS, AND WHY THEY DIFFER
 * ---------------------------------------------------------------------------
 * Rounding cannot be both monotone and sign-symmetric: `floor` is monotone
 * (-0.25 -> -1, +0.25 -> 0), `trunc` is symmetric (both -> 0). Picking one
 * globally breaks something, so each kind of operation gets the one it needs:
 *
 *   SCALING ops (mul, div, mulInt, divInt, lerp) round TOWARD ZERO.
 *     These must satisfy f(-x) === -f(x). If they do not, a character
 *     decelerating leftward loses a fraction of a unit more than one
 *     decelerating rightward. That is invisible for a minute, then the level
 *     is unbeatable and recorded replays desync, and it reads as a physics
 *     bug rather than a rounding bug, so it is expensive to find.
 *
 *   COORDINATE->CELL ops (toPx, toTile) round DOWN (floor).
 *     These map a continuous coordinate onto a discrete grid, where
 *     monotonicity is the whole point: x = -0.5 px must land in pixel -1, and
 *     symmetric rounding would put two different coordinates in the same cell
 *     on either side of the origin.
 *
 * `fixed.test.ts` asserts both properties directly. Negative zero is collapsed
 * to +0 by `truncDiv` so it can never enter the world state.
 */

/** An integer count of 1/4096 px. Brand prevents mixing with raw pixels. */
export type Fixed = number & { readonly __fixed: unique symbol };

/** Fixed-point units in one pixel. */
export const ONE = 4096;
/** Pixels per tile. */
export const TILE_PX = 16;
/** Fixed-point units in one tile. */
export const TILE = (TILE_PX * ONE) as Fixed; // 65536

/**
 * Sanity bound for any Fixed stored in the world.
 *
 * The largest legal level is 240 tiles wide, or ~1.57e7 units; speeds top out
 * around 1e4. This bound sits ~68x above the largest real coordinate, so it
 * catches corruption without rejecting legitimate values.
 *
 * The real correctness constraint for `mul` is that the intermediate `a * b`
 * stays under 2^53 (9.0e15), where doubles are still exact. The worst product
 * the sim actually forms is position x velocity (~1.6e11) and slope
 * interpolation (~2.7e8), both are six orders of magnitude clear. Two values
 * at this bound would exceed it, so `assertFixed` is what keeps values from
 * ever getting near the bound in the first place.
 */
const MAX_MAGNITUDE = 1073741824; // 2^30

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** Pixels -> Fixed. Accepts a float; this is a boundary conversion, not sim math. */
export function fromPx(px: number): Fixed {
  return Math.floor(px * ONE) as Fixed;
}

/** Tiles -> Fixed. */
export function fromTiles(tiles: number): Fixed {
  return Math.floor(tiles * TILE) as Fixed;
}

/** Raw integer units -> Fixed. Use for constants that are already scaled. */
export function raw(units: number): Fixed {
  return units as Fixed;
}

// ---------------------------------------------------------------------------
// Conversion out (rendering / debug only, never feed these back into the sim)
// ---------------------------------------------------------------------------

/** Fixed -> whole pixels, rounded toward negative infinity. */
export function toPx(v: Fixed): number {
  return Math.floor(v / ONE);
}

/** Fixed -> pixels as a float. Debug overlays and the renderer's camera only. */
export function toPxFloat(v: Fixed): number {
  return v / ONE;
}

/** Fixed -> the tile index containing this coordinate. */
export function toTile(v: Fixed): number {
  return Math.floor(v / TILE);
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/**
 * Symmetric division: rounds toward zero and never returns -0.
 *
 * The single primitive every scaling operation goes through, so the
 * `f(-x) === -f(x)` guarantee lives in one place. `Math.trunc` supplies the
 * symmetry; the `=== 0` check collapses -0 to +0 (it compares equal, so this
 * catches both) and keeps negative zero out of the world state entirely.
 */
function truncDiv(numerator: number, denominator: number): number {
  const q = Math.trunc(numerator / denominator);
  return q === 0 ? 0 : q;
}

/**
 * Fixed x Fixed -> Fixed.
 *
 * Divides by ONE inside the same expression, so the intermediate `a * b` is a
 * double (exact to 2^53) and never touches int32. Since ONE is a power of
 * two the division itself is exact, so the only rounding is the final trunc.
 */
export function mul(a: Fixed, b: Fixed): Fixed {
  return truncDiv(a * b, ONE) as Fixed;
}

/** Fixed / Fixed -> Fixed. */
export function div(a: Fixed, b: Fixed): Fixed {
  return truncDiv(a * ONE, b) as Fixed;
}

/**
 * Fixed x plain integer -> Fixed.
 *
 * Scaling by a whole number (a tile count, a segment index) needs no rescaling,
 * and going through `mul` would force the caller to build a Fixed just to
 * multiply by 3. Exact, so the only thing to handle is -0.
 */
export function mulInt(a: Fixed, n: number): Fixed {
  const p = a * n;
  return (p === 0 ? 0 : p) as Fixed;
}

/**
 * Fixed / plain integer -> Fixed, rounding toward zero.
 *
 * Used by collision sub-stepping to split a frame's movement into n equal
 * pieces. The pieces will not always sum back to the original when the division
 * is inexact: sub-stepping re-derives the remainder each step rather than
 * assuming they do.
 */
export function divInt(a: Fixed, n: number): Fixed {
  return truncDiv(a, n) as Fixed;
}

// ---------------------------------------------------------------------------
// Sign-symmetric helpers
// ---------------------------------------------------------------------------
//
// These exist so that physics code never has to branch on sign, which is where
// mirror asymmetry creeps in. Each satisfies f(-x) === -f(x) by construction.

export function abs(v: Fixed): Fixed {
  return (v < 0 ? -v : v) as Fixed;
}

/** -1, 0 or +1. */
export function sign(v: Fixed): -1 | 0 | 1 {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

/** Clamp to [-limit, +limit]. `limit` must be non-negative. */
export function clampMagnitude(v: Fixed, limit: Fixed): Fixed {
  if (v > limit) return limit;
  if (v < -limit) return (limit === 0 ? 0 : -limit) as Fixed;
  return v;
}

export function clamp(v: Fixed, lo: Fixed, hi: Fixed): Fixed {
  return (v < lo ? lo : v > hi ? hi : v) as Fixed;
}

/**
 * Move `v` toward zero by `amount`, stopping exactly at zero.
 *
 * This is the friction/deceleration primitive. Doing it as
 * `v - sign(v) * amount` and clamping at zero is what makes stopping symmetric:
 * a character decelerating leftward reaches exactly 0, never -1, and so never
 * creeps in the opposite direction on the frame after it stops.
 */
export function approachZero(v: Fixed, amount: Fixed): Fixed {
  if (v > 0) return (v - amount > 0 ? v - amount : 0) as Fixed;
  if (v < 0) return (v + amount < 0 ? v + amount : 0) as Fixed;
  return 0 as Fixed;
}

/** Move `v` toward `target` by at most `amount`. */
export function approach(v: Fixed, target: Fixed, amount: Fixed): Fixed {
  if (v < target) return (v + amount > target ? target : v + amount) as Fixed;
  if (v > target) return (v - amount < target ? target : v - amount) as Fixed;
  return v;
}

/**
 * Linear interpolation at t/ONE between a and b.
 *
 * Used for slope surface heights. The subtraction happens first so the product
 * stays proportional to the *difference* rather than to the absolute
 * coordinate: the difference is at most one tile, which keeps the intermediate
 * far away from any overflow concern even at the far end of a large level.
 */
export function lerp(a: Fixed, b: Fixed, t: Fixed): Fixed {
  return (a + truncDiv((b - a) * t, ONE)) as Fixed;
}

// ---------------------------------------------------------------------------
// Dev-mode invariants
// ---------------------------------------------------------------------------

/**
 * Throws if `v` is not a safe integer within the legal magnitude.
 *
 * Call this at the boundaries where a bad value would otherwise be written into
 * a typed array and become invisible (an Int32Array silently truncates). Strip
 * the calls in production builds; they exist to make "how did x become 1.5"
 * fail at the write rather than three systems later.
 */
export function assertFixed(v: number, label = "value"): asserts v is Fixed {
  if (!Number.isInteger(v)) {
    throw new Error(`${label} must be an integer Fixed, got ${v}`);
  }
  if (v > MAX_MAGNITUDE || v < -MAX_MAGNITUDE) {
    throw new Error(`${label} out of Fixed range: ${v} (limit +/-${MAX_MAGNITUDE})`);
  }
}
