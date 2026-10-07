/* eslint-disable no-bitwise --
 * THE ONE FILE IN THE ENGINE WHERE BITWISE OPERATORS ARE CORRECT.
 *
 * Everywhere else, `no-bitwise` exists because bitwise operators silently
 * coerce to int32 and corrupt fixed-point values that exceed it (see
 * math/fixed.ts). Here that coercion is not a hazard, it is the specification:
 * mulberry32 is *defined* as a sequence of int32 operations with wraparound.
 * ECMAScript pins the exact semantics of `|0`, `^`, `>>>` and `Math.imul`, so
 * this generator produces byte-identical output on every engine and platform,
 * which is precisely the property the sim needs.
 */

/**
 * Seeded pseudo-random numbers for the simulation.
 *
 * The sim must never call `Math.random`: its sequence differs per run, so a
 * replay of the same inputs would diverge and a recorded clear could not be
 * verified. Every random decision in the world instead comes from this
 * generator, whose entire state is one integer that lives in the world
 * snapshot, so rewinding the world rewinds the randomness with it.
 *
 * mulberry32 was chosen over PCG32 because PCG32 needs 64-bit arithmetic,
 * which in JS means BigInt (10-40x slower) or a hand-rolled 64-bit emulation.
 * mulberry32 is a single int32 of state, passes gjrand's test suite, and has a
 * period of 2^32, around 800 days of continuous 60Hz ticks, and vastly more
 * than any single level run will consume.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    // `| 0` normalizes any incoming number (including a float or a value past
    // 2^31) into the int32 domain the algorithm is defined on.
    this.state = seed | 0;
  }

  /** The full generator state. Include this in every world snapshot. */
  getState(): number {
    return this.state;
  }

  /** Restore a previously captured state, used by rewind and replay. */
  setState(state: number): void {
    this.state = state | 0;
  }

  /** Next raw 32-bit unsigned value. Every other method is derived from this. */
  nextU32(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  }

  /**
   * Uniform integer in [0, bound).
   *
   * Uses rejection sampling rather than a plain modulo. Modulo alone biases
   * toward the low end whenever `bound` does not divide 2^32 evenly: with a
   * small bound the bias is tiny, but it is a systematic thumb on the scale for
   * anything the game does repeatedly, and rejection costs almost nothing since
   * a retry is needed only for the sliver past the last whole multiple.
   */
  nextInt(bound: number): number {
    if (bound <= 0) return 0;
    const limit = 4294967296 - (4294967296 % bound);
    let v = this.nextU32();
    while (v >= limit) v = this.nextU32();
    return v % bound;
  }

  /** Uniform integer in [min, max], inclusive at both ends. */
  nextRange(min: number, max: number): number {
    return min + this.nextInt(max - min + 1);
  }

  /** True with probability numerator/denominator. */
  chance(numerator: number, denominator: number): boolean {
    return this.nextInt(denominator) < numerator;
  }

  /** -1 or +1. */
  nextSign(): -1 | 1 {
    return this.nextInt(2) === 0 ? -1 : 1;
  }
}
