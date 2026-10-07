import { abs, approachZero, clampMagnitude, fromPx, sign, type Fixed } from "../math/fixed";
import { TileFlags, hasAny } from "../core/flags";
import { Button, axisX, isHeld, isPressed, type InputFrame } from "../core/input";
import type { Tilemap } from "../collision/tilemap";
import { moveActor, type Actor, type MoveResult } from "../collision/resolve";
import {
  ACCEL_RUN,
  ACCEL_WALK,
  COYOTE_FRAMES,
  DECEL_RELEASE,
  DECEL_SKID,
  ICE_FRICTION_DENOMINATOR,
  ICE_FRICTION_NUMERATOR,
  JUMP_BUFFER_FRAMES,
  MAX_FALL,
  MAX_RUN,
  MAX_WALK,
  RUN_GRACE_FRAMES,
  jumpTierFor,
} from "../styles/retro";

/**
 * PLAYER MOVEMENT.
 *
 * All the feel lives here. The constants come from styles/retro.ts; this file
 * is the ordering and the state machine that make them feel right.
 *
 * The ordering below is not arbitrary: horizontal speed must be finalised
 * BEFORE the jump is evaluated, because the jump tier is selected from the
 * speed at the takeoff frame.
 */

export interface PlayerState {
  x: Fixed;
  y: Fixed;
  vx: Fixed;
  vy: Fixed;
  halfW: Fixed;
  halfH: Fixed;
  face: -1 | 1;

  grounded: boolean;

  /**
   * Warp-pipe transit.
   *
   * 0 when free. Counts down while the player is being swallowed by, or pushed
   * out of, a pipe. While it is non-zero the player system is skipped entirely:
   * no input, no gravity, no collision - the sim is moving him, not the player.
   *
   * Held here rather than in the host because a warp changes where the run goes
   * next, and anything that can change the outcome of a run has to be in the
   * simulation or replays stop matching.
   */
  pipeFrames: number;
  /** 1 while being swallowed, -1 while emerging, 0 otherwise. */
  pipePhase: -1 | 0 | 1;
  /**
   * Direction that must be RELEASED before another pipe will accept you.
   *
   * 0 means ready. 1 up, 2 down, 3 left, 4 right - a plain number rather than
   * the PipeDir string so this module keeps no dependency on the level format.
   *
   * This exists because the alternative, requiring a fresh press, does not
   * survive contact with a real player: the press lands on a frame where you
   * are not yet grounded, gets eaten, and from then on you are merely HOLDING
   * the button, so the pipe never opens. Holding is what people actually do.
   */
  pipeArmDir: number;
  /** Unit direction of travel through the pipe, in whole pixels per frame. */
  pipeDx: number;
  pipeDy: number;
  /** Frames since the player was last grounded. Drives coyote time. */
  airborneFrames: number;
  /** Frames since the jump button was last pressed. Drives the jump buffer. */
  jumpBufferFrames: number;
  /** Counts down while the run cap applies. See RUN_GRACE_FRAMES. */
  runGraceFrames: number;
  /** True while rising with the jump button still held (low gravity). */
  jumpRising: boolean;
  /** Gravity values captured at takeoff, so the whole arc uses one tier. */
  gravityRise: Fixed;
  gravityFall: Fixed;
  /** Material under the feet last tick; ice changes acceleration. */
  groundFlags: number;

  /**
   * Power tier: 0 small, 1 super.
   *
   * Modelled as a NUMBER rather than a boolean because the
   * damage rule is "step down one tier", and more tiers are coming (fire,
   * and the style-specific forms). A boolean would have to be rewritten the
   * moment a third state exists, and every call site with it.
   */
  powerTier: number;
  /** Frames of post-damage invulnerability remaining. */
  iFrames: number;
  /**
   * True on the single tick a jump was launched.
   *
   * A flag rather than a callback, because the sim owns the event stream and
   * the player system must stay free of side effects: it has to run headless
   * in a replay where nothing is listening.
   */
  justJumped: boolean;
}

/** Post-damage invulnerability: 158 frames (about 2.6 s at 60 fps). */
export const IFRAME_DURATION = 158;

/** Half-heights per power tier. A bigger player has a taller hitbox. */
export const TIER_HALF_H = [fromPx(12), fromPx(15)];

export function createPlayer(x: Fixed, y: Fixed, halfW: Fixed, halfH: Fixed): PlayerState {
  return {
    x,
    y,
    vx: 0 as Fixed,
    vy: 0 as Fixed,
    halfW,
    halfH,
    face: 1,
    grounded: false,
    pipeFrames: 0,
    pipePhase: 0,
    pipeArmDir: 0,
    pipeDx: 0,
    pipeDy: 0,
    airborneFrames: 999,
    jumpBufferFrames: 999,
    runGraceFrames: 0,
    jumpRising: false,
    // Seeded from the standing tier so that walking off a ledge without ever
    // jumping still falls correctly. Leaving these at zero and substituting a
    // fallback at the use site is how you end up applying terminal VELOCITY as
    // an ACCELERATION, a ten-fold error that only shows up on ledges.
    gravityRise: jumpTierFor(0 as Fixed).gravityRise,
    gravityFall: jumpTierFor(0 as Fixed).gravityFall,
    groundFlags: TileFlags.NONE,
    powerTier: 0,
    iFrames: 0,
    justJumped: false,
  };
}

/**
 * Apply one hit.
 *
 * Returns true if the player died. The order matters:
 * invulnerability wins over everything, then a power tier absorbs the
 * hit, and only a hit at the lowest tier is fatal.
 */
export function damagePlayer(p: PlayerState): boolean {
  if (p.iFrames > 0) return false;
  if (p.powerTier > 0) {
    setPowerTier(p, p.powerTier - 1);
    p.iFrames = IFRAME_DURATION;
    return false;
  }
  return true;
}

/**
 * Change power tier, keeping the player's FEET planted.
 *
 * Growing expands the hitbox, and expanding it around the centre would push the
 * head up AND the feet down, into the floor, where the crush rule lives.
 * Anchoring at the feet is what makes growing while standing safe.
 */
export function setPowerTier(p: PlayerState, tier: number): void {
  const clamped = Math.max(0, Math.min(TIER_HALF_H.length - 1, tier));
  const feet = (p.y + p.halfH) as Fixed;
  p.powerTier = clamped;
  p.halfH = TIER_HALF_H[clamped];
  p.y = (feet - p.halfH) as Fixed;
}

/** Scale an acceleration for a low-friction surface. */
function iced(value: Fixed, onIce: boolean): Fixed {
  if (!onIce) return value;
  return Math.floor((value * ICE_FRICTION_NUMERATOR) / ICE_FRICTION_DENOMINATOR) as Fixed;
}

/**
 * Advance the player one tick.
 *
 * Returns the collision result so the caller can react to landings, wall hits
 * and ground material.
 */
export function stepPlayer(p: PlayerState, map: Tilemap, input: InputFrame): MoveResult {
  if (p.iFrames > 0) p.iFrames -= 1;
  p.justJumped = false;
  const dir = axisX(input);
  const runHeld = isHeld(input, Button.B);
  const onIce = hasAny(p.groundFlags, TileFlags.ICE);

  // -------------------------------------------------------------------------
  // 1. Run-grace timer
  // -------------------------------------------------------------------------
  // The higher speed cap persists for a few frames after the run button is
  // released, provided you were grounded and moving the way you were pressing.
  // This is why run speed survives a brief release, and why speed effectively
  // locks once you are airborne: the timer stops being refreshed.
  if (runHeld && p.grounded && dir !== 0 && dir === sign(p.vx)) {
    p.runGraceFrames = RUN_GRACE_FRAMES;
  } else if (p.runGraceFrames > 0) {
    p.runGraceFrames -= 1;
  }
  const cap = p.runGraceFrames > 0 || runHeld ? MAX_RUN : MAX_WALK;

  // -------------------------------------------------------------------------
  // 2. Horizontal acceleration and friction
  // -------------------------------------------------------------------------
  if (dir !== 0) {
    const skidding = sign(p.vx) !== 0 && sign(p.vx) !== dir;
    if (skidding) {
      // Facing opposite the direction of travel: the active friction value is
      // doubled. This is what gives a hard turnaround its weight.
      p.vx = approachZero(p.vx, iced(DECEL_SKID, onIce));
    } else {
      const accel = iced(runHeld ? ACCEL_RUN : ACCEL_WALK, onIce);
      p.vx = (p.vx + accel * dir) as Fixed;
    }
    p.face = dir;
  } else if (p.grounded) {
    // NO AIR FRICTION. Friction applies in the air only when a
    // direction is actually held, so releasing the stick mid-jump preserves
    // horizontal speed exactly. Adding drag here would feel mushy in a way
    // players notice immediately without being able to name it.
    p.vx = approachZero(p.vx, iced(DECEL_RELEASE, onIce));
  }

  // Clamp AFTER accelerating. The attainable maximum is
  // therefore one acceleration step past the nominal cap.
  p.vx = clampMagnitude(p.vx, cap);

  // -------------------------------------------------------------------------
  // 3. Jump
  // -------------------------------------------------------------------------
  if (isPressed(input, Button.A)) p.jumpBufferFrames = 0;
  else if (p.jumpBufferFrames < 999) p.jumpBufferFrames += 1;

  const canCoyote = p.airborneFrames <= COYOTE_FRAMES;
  const bufferedJump = p.jumpBufferFrames <= JUMP_BUFFER_FRAMES;

  if (bufferedJump && (p.grounded || canCoyote)) {
    // Tier is chosen from the speed on THIS frame, not the frame the player
    // left the ground. With coyote time active those differ, and using the
    // stale one gives fast ledge-jumps a visibly wrong arc.
    const tier = jumpTierFor(abs(p.vx));
    p.vy = tier.launch;
    p.gravityRise = tier.gravityRise;
    p.gravityFall = tier.gravityFall;
    p.jumpRising = true;
    p.grounded = false;
    p.airborneFrames = 999; // consume the coyote window
    p.jumpBufferFrames = 999; // consume the buffered press
    p.justJumped = true;
  }

  // -------------------------------------------------------------------------
  // 4. Gravity
  // -------------------------------------------------------------------------
  // Variable jump height is a GRAVITY SWAP, not a velocity cut. While rising
  // with the button held, the small value applies; the instant the button is
  // released or the rise ends, the large value is copied in and CANNOT be
  // swapped back for the rest of the airtime. Implementing this as "zero the
  // velocity on release" produces a completely different, much worse feel.
  if (p.jumpRising && (!isHeld(input, Button.A) || p.vy >= 0)) {
    p.jumpRising = false;
  }
  const gravity = p.jumpRising ? p.gravityRise : p.gravityFall;
  p.vy = (p.vy + gravity) as Fixed;
  if (p.vy > MAX_FALL) p.vy = MAX_FALL;

  // -------------------------------------------------------------------------
  // 5. Collision
  // -------------------------------------------------------------------------
  const actor: Actor = {
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    halfW: p.halfW,
    halfH: p.halfH,
    prevBottom: (p.y + p.halfH) as Fixed,
    wasGrounded: p.grounded,
    dropThrough: isHeld(input, Button.DOWN),
  };
  const result = moveActor(map, actor);

  p.x = actor.x;
  p.y = actor.y;
  p.vx = actor.vx;
  p.vy = actor.vy;

  const wasGrounded = p.grounded;
  p.grounded = result.grounded;
  p.groundFlags = result.grounded ? result.groundFlags : TileFlags.NONE;

  if (p.grounded) {
    p.airborneFrames = 0;
    p.jumpRising = false;
  } else if (wasGrounded) {
    // Just walked off an edge: start the coyote window.
    p.airborneFrames = 1;
  } else if (p.airborneFrames < 999) {
    p.airborneFrames += 1;
  }

  return result;
}
