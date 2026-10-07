import { Button, type ButtonId } from "@/engine/core/input";
import type { IconName } from "./ui/glyphs";

/**
 * WHAT THE CONTROLS GUIDE SAYS.
 *
 * Data, in a plain .ts with no JSX and no DOM, for one concrete reason: vitest
 * runs in the `node` environment here and its include glob is
 * src/(star)(star)/*.test.ts, so a .test.tsx would never run. Splitting the
 * CONTENT out of the component is what makes the content testable at all.
 *
 * And it needs testing. The old help text - "ARROWS MOVE - SPACE JUMP - R
 * AGAIN" - was a hardcoded string in the play chrome, and it was wrong twice
 * over: it named keys a tablet does not have, and nothing connected it to the
 * real bindings, so rebinding a key would have left it quietly lying. Every row
 * below carries the KeyboardEvent.codes it claims, and controls.test.ts checks
 * each one against KEY_BINDINGS.
 *
 * THE VOCABULARY RULE, from src/design/tokens.ts: say what it DOES in words a
 * young player uses. "Slide your thumb on the pad", not "analogue directional input".
 */

export type Scheme = "touch" | "keys" | "pad";

export interface Move {
  /** What it does, in one word where possible. */
  label: string;
  /** Icon first, word second. Nothing in this interface leads with text. */
  icon: IconName;
  /** What to do with a finger. */
  touch: string;
  /** Key names as a young player would read them aloud, best first. */
  keys: string[];
  /** KeyboardEvent.code for each name above, in the same order. Pinned by a test. */
  codes: string[];
  /** What to press on a gamepad. */
  pad: string;
  /** When you would want it. Optional - only where it is not obvious. */
  note?: string;
  /**
   * The engine button this row is about, or null for a host-level action that
   * never reaches the simulation. Rows with a button get their codes checked.
   */
  button: ButtonId | null;
}

export const MOVES: readonly Move[] = [
  {
    label: "GO",
    icon: "right",
    touch: "Slide your thumb on the square pad",
    keys: ["ARROWS", "A", "D"],
    codes: ["ArrowRight", "KeyD"],
    pad: "Stick or d-pad",
    button: Button.RIGHT,
  },
  {
    label: "JUMP",
    icon: "up",
    touch: "Tap the green JUMP button",
    keys: ["SPACE", "Z", "K"],
    codes: ["Space", "KeyZ", "KeyK"],
    pad: "A button",
    note: "Hold it down to jump higher",
    button: Button.A,
  },
  {
    label: "RUN",
    icon: "sparkle",
    touch: "Hold the yellow RUN button",
    keys: ["SHIFT", "X", "J"],
    codes: ["ShiftLeft", "ShiftRight", "KeyX", "KeyJ"],
    pad: "B button",
    note: "Hold RUN and you go faster, and jump further",
    button: Button.B,
  },
  {
    label: "DUCK",
    icon: "down",
    touch: "Push down on the pad",
    keys: ["DOWN", "S"],
    codes: ["ArrowDown", "KeyS"],
    pad: "Stick or d-pad down",
    note: "Drops you through a thin floor",
    button: Button.DOWN,
  },
  {
    label: "PIPE",
    icon: "down",
    touch: "Stand at a pipe and push toward it",
    keys: ["ARROWS"],
    codes: ["ArrowDown"],
    pad: "Stick or d-pad",
    note: "Push the way the pipe points",
    button: Button.DOWN,
  },
  {
    label: "TRY AGAIN",
    icon: "undo",
    touch: "Tap the arrow button in the top bar",
    keys: ["R"],
    codes: [],
    pad: "Not on a pad",
    note: "Start the level from the beginning",
    button: null,
  },
  {
    label: "BUILD",
    icon: "pencil",
    touch: "Tap BUILD in the top bar",
    keys: ["ENTER", "ESC"],
    codes: [],
    pad: "Not on a pad",
    note: "Go back to making the level",
    button: null,
  },
];

/**
 * The one-line hint printed under the level title in play mode.
 *
 * Comes from here rather than from a literal in the chrome so that the hint and
 * the guide cannot disagree - and so that no build ever again tells a tablet
 * player to press SPACE.
 */
export function hintFor(scheme: Scheme): string {
  switch (scheme) {
    case "touch":
      return "PAD MOVES - JUMP JUMPS - ? FOR HELP";
    case "pad":
      return "STICK MOVES - A JUMPS - B RUNS";
    default:
      return "ARROWS MOVE - SPACE JUMP - R AGAIN - ? HELP";
  }
}

/** Which column of the guide to open on, given what the player is holding. */
export function schemeFor(touch: boolean, gamepad: boolean): Scheme {
  if (gamepad) return "pad";
  return touch ? "touch" : "keys";
}
