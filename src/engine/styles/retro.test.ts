import { describe, expect, it } from "vitest";
import { ONE, TILE_PX, raw, type Fixed } from "../math/fixed";
import {
  ACCEL_RUN,
  ACCEL_WALK,
  DECEL_RELEASE,
  DECEL_SKID,
  JUMP_TIERS,
  MAX_FALL,
  MAX_RUN,
  MAX_WALK,
  jumpTierFor,
} from "./retro";

/**
 * These are the golden values for how the game FEELS. They are written as
 * outcomes a person can check against the real thing ("a standing jump clears
 * four blocks") rather than as byte constants, so a regression reports
 * something meaningful instead of a diff of magic numbers.
 */

/** Simulate a jump and return its apex height in pixels. */
function jumpApexPx(startVx: Fixed, holdButton: boolean): number {
  const tier = jumpTierFor(startVx);
  let vy = tier.launch;
  let y = 0;
  let peak = 0;
  // Gravity swaps to the fall value the moment the button is released or the
  // rise ends, and can never swap back: that IS the variable-height mechanic.
  let rising = true;

  for (let frame = 0; frame < 240; frame++) {
    const gravity = rising && holdButton ? tier.gravityRise : tier.gravityFall;
    vy = (vy + gravity) as Fixed;
    if (vy >= 0) rising = false;
    if (vy > MAX_FALL) vy = MAX_FALL;
    y += vy;
    if (-y > peak) peak = -y;
    if (y > 0) break; // back to the ground
  }
  return peak / ONE;
}

describe("horizontal speed", () => {
  it("caps at the documented walk and run speeds", () => {
    expect(MAX_WALK / ONE).toBe(1.5);
    expect(MAX_RUN / ONE).toBe(2.5);
  });

  it("reaches the run cap in a plausible number of frames", () => {
    let vx = 0 as Fixed;
    let frames = 0;
    while (vx < MAX_RUN && frames < 600) {
      vx = (vx + ACCEL_RUN) as Fixed;
      frames++;
    }
    // 10240 / 228 = 45 frames, i.e. three quarters of a second to top speed.
    // Far slower than an arcade game, and exactly why the character has weight.
    expect(frames).toBe(45);
  });

  it("accelerates faster running than walking", () => {
    expect(ACCEL_RUN).toBeGreaterThan(ACCEL_WALK);
  });

  it("skids at exactly double the release deceleration", () => {
    // Skid is the active friction value doubled (one arithmetic shift left). At the speeds
    // where skidding matters that is the release value, so the named constant is 2x208,
    // not 2x152.
    expect(DECEL_SKID).toBe(2 * DECEL_RELEASE);
    expect(DECEL_SKID).toBeGreaterThan(ACCEL_WALK);
  });

  it("stops from full run in about a third of a second", () => {
    let vx = MAX_RUN;
    let frames = 0;
    while (vx > 0 && frames < 600) {
      vx = Math.max(0, vx - DECEL_RELEASE) as Fixed;
      frames++;
    }
    expect(frames).toBe(50);
  });
});

describe("jump", () => {
  /**
   * The apex targets are ~4 and ~5 tiles, asserted as bands rather than exact
   * values.
   *
   * The closed form v0^2/(2g) gives exactly 64px and 80px, but a discrete
   * per-frame integration lands a few pixels either side depending on whether
   * gravity is applied before or after the position update; this model gives
   * 62px and 77.5px. A sub-fraction accumulator would resolve it more
   * finely; we have not modelled that frame-for-frame, so the exact heights
   * are not treated as settled.
   *
   * So the band is deliberate: it locks the feel (four-ish and five-ish blocks,
   * a full block apart) while leaving room to tighten the integration later
   * without a spurious failure. Tighten against playtesting before narrowing.
   */
  it("clears about four blocks standing", () => {
    const tiles = jumpApexPx(raw(0), true) / TILE_PX;
    expect(tiles).toBeGreaterThan(3.75);
    expect(tiles).toBeLessThan(4.25);
  });

  it("clears about five blocks at full run", () => {
    // The whole point of momentum-coupled jumps: running changes the ARC, not
    // just the horizontal distance. This is the "run to clear the gap" grammar
    // that level design is built on.
    const tiles = jumpApexPx(MAX_RUN, true) / TILE_PX;
    expect(tiles).toBeGreaterThan(4.75);
    expect(tiles).toBeLessThan(5.25);
  });

  it("gains close to a full block of height from running", () => {
    const standing = jumpApexPx(raw(0), true);
    const running = jumpApexPx(MAX_RUN, true);
    expect((running - standing) / TILE_PX).toBeGreaterThan(0.75);
  });

  it("gets meaningfully lower when the button is released early", () => {
    const held = jumpApexPx(raw(0), true);
    const tapped = jumpApexPx(raw(0), false);
    expect(tapped).toBeLessThan(held / 2);
  });

  it("selects tiers by speed at the moment of takeoff", () => {
    expect(jumpTierFor(raw(0)).launch).toBe(-4 * ONE);
    expect(jumpTierFor(MAX_WALK).launch).toBe(-4 * ONE);
    expect(jumpTierFor(MAX_RUN).launch).toBe(-5 * ONE);
  });

  it("orders tiers from fastest to slowest so the first match wins", () => {
    for (let i = 1; i < JUMP_TIERS.length; i++) {
      expect(JUMP_TIERS[i].minSpeed).toBeLessThanOrEqual(JUMP_TIERS[i - 1].minSpeed);
    }
    expect(JUMP_TIERS[JUMP_TIERS.length - 1].minSpeed).toBe(0);
  });

  it("falls at least three times faster than it rises", () => {
    // The gravity swap ratio is what gives the jump its snap. A symmetric arc
    // reads as floaty and wrong even when the apex height is identical.
    for (const tier of JUMP_TIERS) {
      expect(tier.gravityFall / tier.gravityRise).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("terminal velocity", () => {
  it("pins at 4 px/frame", () => {
    expect(MAX_FALL / ONE).toBe(4);
  });

  it("takes a moment to reach, so short drops keep their weight", () => {
    let vy = 0 as Fixed;
    let frames = 0;
    const g = JUMP_TIERS[0].gravityFall;
    while (vy < MAX_FALL && frames < 600) {
      vy = Math.min(MAX_FALL, vy + g) as Fixed;
      frames++;
    }
    expect(frames).toBe(8);
  });
});
