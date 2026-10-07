import { TILE, fromPx, type Fixed } from "../math/fixed";
import { Button, isHeld, type InputFrame } from "../core/input";
import type { PipeDir, PipeLink } from "../level/compile";
import type { PlayerState } from "./player";

/**
 * WARP PIPES.
 *
 * Go in one end, come out the other. The oldest secret in the genre, and the
 * one thing a young player will try to build within a minute of being shown
 * a pipe.
 *
 * ---------------------------------------------------------------------------
 * HOW A PIPE IS DESCRIBED
 * ---------------------------------------------------------------------------
 * Nowhere. That is the point. There is no pipe object with a destination field,
 * because that would mean a new field on the level document and a migration for
 * every level anyone has already saved. Instead the author places two mouths of
 * the SAME COLOUR and the compiler pairs them, and the direction each one opens
 * is read off the pipe body next to it. Both facts fall out of what was built.
 *
 * ---------------------------------------------------------------------------
 * WHY THE TRANSIT IS IN THE SIM
 * ---------------------------------------------------------------------------
 * Because it changes where the run goes. Anything that can change the outcome
 * of a run has to be deterministic and replayable, so the animation frames, the
 * teleport and the emerging push all live here in fixed point, with no clock and
 * no randomness. Only the SOUND of it is host-side.
 */

/** Frames spent being swallowed, and again being pushed back out. */
export const PIPE_FRAMES = 22;

/** Travel per frame while in transit: one pixel. Slow enough to read. */
const PIPE_SPEED = fromPx(1);

/** How close to the middle of a mouth the player must be, in whole pixels. */
const PIPE_ALIGN = fromPx(10);

function dirOf(dir: PipeDir): { dx: number; dy: number } {
  if (dir === "down") return { dx: 0, dy: 1 };
  if (dir === "up") return { dx: 0, dy: -1 };
  if (dir === "left") return { dx: -1, dy: 0 };
  return { dx: 1, dy: 0 };
}

/** Direction codes stored on the player. See PlayerState.pipeArmDir. */
const DIR_CODE: Record<PipeDir, number> = { up: 1, down: 2, left: 3, right: 4 };
const CODE_BUTTON = [0, Button.UP, Button.DOWN, Button.LEFT, Button.RIGHT] as const;

function buttonFor(dir: PipeDir) {
  return dir === "up"
    ? Button.UP
    : dir === "down"
      ? Button.DOWN
      : dir === "left"
        ? Button.LEFT
        : Button.RIGHT;
}

/**
 * True when the player is asking to go INTO this mouth.
 *
 * HELD, not the press edge, for every direction.
 *
 * The press-edge version looked correct and failed in practice: standing on a
 * pipe and pressing down, the edge lands on a frame where `grounded` is still
 * false, gets eaten by the alignment check, and from then on the button is
 * merely held - so the pipe never opens no matter how long you hold it. Holding
 * a direction at a pipe is what a person does, so that is what has to work.
 *
 * Ping-pong is prevented by `pipeArmDir` instead: after a warp, the direction
 * that took you in has to be RELEASED before any pipe will take you again.
 */
function pressingInto(input: InputFrame, dir: PipeDir): boolean {
  return isHeld(input, buttonFor(dir));
}

/**
 * Is the player lined up with this mouth, from the correct side?
 *
 * Deliberately generous on the across-axis and strict on the along-axis: being
 * roughly over a downward pipe should be enough, but standing beside one and
 * pressing down should not swallow you. A young player aiming at a pipe
 * reads a near miss as the pipe being broken.
 */
function aligned(p: PlayerState, link: PipeLink): boolean {
  const cx = (link.tx * TILE + TILE / 2) as Fixed;
  const cy = (link.ty * TILE + TILE / 2) as Fixed;

  if (link.dir === "down" || link.dir === "up") {
    if (Math.abs(p.x - cx) > PIPE_ALIGN) return false;
    // Entering downward requires standing on it; upward requires being under it.
    return link.dir === "down"
      ? p.grounded && Math.abs(p.y + p.halfH - cy) <= TILE
      : Math.abs(p.y - p.halfH - cy) <= TILE;
  }

  if (Math.abs(p.y - cy) > PIPE_ALIGN) return false;
  // Sideways pipes are entered from the ground, so a jump past one does not
  // suck you in mid-air.
  if (!p.grounded) return false;
  return link.dir === "left"
    ? Math.abs(p.x - p.halfW - cx) <= TILE
    : Math.abs(p.x + p.halfW - cx) <= TILE;
}

/**
 * Start a warp if the player is standing at a mouth and pressing into it.
 *
 * Returns the link taken, or null. The caller owns what happens next; this only
 * decides that it happens.
 */
export function tryEnterPipe(
  p: PlayerState,
  input: InputFrame,
  pipes: readonly PipeLink[],
): PipeLink | null {
  if (p.pipeFrames > 0) return null;

  // Re-arm once the direction that took you in has been let go. Until then no
  // pipe will accept you, which is what stops the two ends of a warp bouncing
  // you back and forth while you hold the button.
  if (p.pipeArmDir !== 0) {
    if (isHeld(input, CODE_BUTTON[p.pipeArmDir])) return null;
    p.pipeArmDir = 0;
  }

  for (const link of pipes) {
    if (!pressingInto(input, link.dir)) continue;
    if (!aligned(p, link)) continue;

    const d = dirOf(link.dir);
    p.pipeFrames = PIPE_FRAMES;
    p.pipePhase = 1;
    p.pipeDx = d.dx;
    p.pipeDy = d.dy;
    p.pipeArmDir = DIR_CODE[link.dir];
    p.vx = 0 as Fixed;
    p.vy = 0 as Fixed;
    return link;
  }
  return null;
}

/**
 * Put the player at the far mouth, ready to be pushed out.
 *
 * Placed one tile INSIDE the pipe so that emerging is a real movement rather
 * than a pop: he slides out over PIPE_FRAMES, the same length of time it took
 * to go in, so the two halves feel like one action.
 */
export function exitPipe(p: PlayerState, link: PipeLink): void {
  const d = dirOf(link.exitDir);
  const cx = (link.toTx * TILE + TILE / 2) as Fixed;
  const cy = (link.toTy * TILE + TILE / 2) as Fixed;

  p.x = (cx - d.dx * TILE) as Fixed;
  p.y = (cy - d.dy * TILE) as Fixed;
  p.pipeFrames = PIPE_FRAMES;
  p.pipePhase = -1;
  p.pipeDx = d.dx;
  p.pipeDy = d.dy;
  p.vx = 0 as Fixed;
  p.vy = 0 as Fixed;
  p.grounded = false;
  if (d.dx !== 0) p.face = d.dx > 0 ? 1 : -1;
}

/**
 * Advance one frame of transit.
 *
 * Returns true when the swallowing half has just finished, which is the moment
 * the caller should teleport. Movement is a fixed number of whole-pixel steps,
 * so a warp takes exactly the same number of ticks every time on every machine.
 */
export function stepPipe(p: PlayerState): boolean {
  if (p.pipeFrames <= 0) return false;

  p.x = (p.x + p.pipeDx * PIPE_SPEED) as Fixed;
  p.y = (p.y + p.pipeDy * PIPE_SPEED) as Fixed;
  p.pipeFrames -= 1;

  if (p.pipeFrames > 0) return false;

  const wasEntering = p.pipePhase === 1;
  p.pipePhase = 0;
  return wasEntering;
}
