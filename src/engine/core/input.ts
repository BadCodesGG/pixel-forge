/* eslint-disable no-bitwise --
 * An input frame is a packed bitfield, and packing is what bitwise operators
 * are for. The engine-wide ban targets int32 coercion of fixed-point
 * COORDINATES; a 32-bit input word cannot overflow, so the hazard is absent.
 */

/**
 * ONE TICK OF INPUT.
 *
 * Packed into a single 32-bit word so a replay is one `Uint32Array`, about
 * 14 KB per minute of play, which makes recording every run essentially free.
 *
 * ---------------------------------------------------------------------------
 * WHY HELD AND PRESSED ARE SEPARATE BITS
 * ---------------------------------------------------------------------------
 * The tempting design is one bit per button, with a press OR'd in so a tap that
 * begins and ends between two sim ticks is not lost. That design is broken, and
 * the way it breaks is subtle enough to survive a long time.
 *
 * Variable jump height works by swapping gravity the moment the jump button is
 * RELEASED. If a press is merged into the held bit, a 4 ms tap is indis-
 * tinguishable from a 4 ms hold, so on a 144 Hz display, where most render
 * frames run zero sim ticks, every quick tap produces a full-height jump. Short
 * hops become impossible, and precise platforming breaks on exactly the
 * hardware enthusiasts own.
 *
 * So: the low 16 bits are the button's TRUE state at tick time, and the high 16
 * are edges latched since the last tick. A tap sets the edge bit without ever
 * setting the held bit, and the jump correctly reads as released.
 *
 * This word size would be baked into any replay format, so it has to be right
 * before the first replay is recorded: changing it later invalidates every
 * stored run.
 */
export type InputFrame = number & { readonly __input: unique symbol };

/** Button indices. Values 0-15; the edge bit for button N is at N + 16. */
export const Button = {
  LEFT: 0,
  RIGHT: 1,
  UP: 2,
  DOWN: 3,
  /** Jump. */
  A: 4,
  /** Run / fire. */
  B: 5,
  START: 6,
} as const;
export type ButtonId = (typeof Button)[keyof typeof Button];

const EDGE_SHIFT = 16;

export const EMPTY_INPUT = 0 as InputFrame;

/** True if the button is physically down at this tick. */
export function isHeld(input: InputFrame, button: ButtonId): boolean {
  return (input & (1 << button)) !== 0;
}

/**
 * True if the button went down since the previous tick.
 *
 * Use this for anything that should fire once per press: jumping, opening a
 * door, throwing. Reading `isHeld` instead gives you an action that repeats
 * every tick the button is down, which for jumping means an auto-bouncing
 * character.
 */
export function isPressed(input: InputFrame, button: ButtonId): boolean {
  return (input & (1 << (button + EDGE_SHIFT))) !== 0;
}

/** Build a frame from a set of held buttons and a set of press edges. */
export function makeInput(held: readonly ButtonId[], pressed: readonly ButtonId[]): InputFrame {
  let word = 0;
  for (const b of held) word |= 1 << b;
  for (const b of pressed) word |= 1 << (b + EDGE_SHIFT);
  return word as InputFrame;
}

/**
 * Horizontal intent: -1, 0 or +1.
 *
 * Both directions at once resolves to zero rather than to whichever was checked
 * first. Rolling a thumb across a d-pad produces a frame or two of both, and
 * picking a winner there makes turnarounds inconsistent in a way that feels
 * like input lag.
 */
export function axisX(input: InputFrame): -1 | 0 | 1 {
  const left = isHeld(input, Button.LEFT);
  const right = isHeld(input, Button.RIGHT);
  if (left === right) return 0;
  return left ? -1 : 1;
}

export function axisY(input: InputFrame): -1 | 0 | 1 {
  const up = isHeld(input, Button.UP);
  const down = isHeld(input, Button.DOWN);
  if (up === down) return 0;
  return up ? -1 : 1;
}
