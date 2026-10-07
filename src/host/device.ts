/**
 * WHAT IS POINTING AT THIS SCREEN.
 *
 * One question, asked once: does this device need on-screen controls? It lives
 * here rather than next to the overlay that draws them because the answer also
 * decides where the play chrome sits -- and the bug this file exists to fix was
 * two places disagreeing about it.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY ABSENT: EVERY `hover` QUERY
 * ---------------------------------------------------------------------------
 * The predicate here used to be `(pointer: coarse) && !(hover: hover)`, and
 * that second clause is the whole bug. `hover` does not ask "is there a
 * keyboard". It asks "can a pointer rest somewhere without clicking" -- and a
 * Samsung S Pen held above the glass, an iPad's Magic Keyboard trackpad and any
 * paired Bluetooth mouse all answer yes. On those devices the gate returned
 * false, the overlay rendered nothing, and there was no jump button on screen
 * at all. A tablet player literally could not jump.
 *
 * So: no `hover`, no `any-hover`, ever. If a future change seems to need one,
 * it is the runtime signal in useTouchControls that wants extending instead.
 *
 * NO USER-AGENT SNIFFING EITHER. iPadOS Safari in desktop mode reports a macOS
 * UA, and would be misread by every string test anyone would think to write. It
 * still reports maxTouchPoints 5 and a coarse primary pointer, so asking about
 * capabilities gets it right for free.
 */

/** What the browser reports about the pointing devices attached right now. */
export interface PointerCapabilities {
  /** navigator.maxTouchPoints. 0 means the hardware has no touchscreen. */
  readonly maxTouchPoints: number;
  /** (pointer: coarse) -- the PRIMARY pointer is a finger-sized one. */
  readonly primaryCoarse: boolean;
}

/**
 * Should this device get on-screen controls?
 *
 * Pure, and separated from the DOM read below, so that the whole device table
 * is a unit test: vitest runs in a `node` environment here, so anything that
 * touches `window` is untestable by construction.
 *
 * `maxTouchPoints > 0` is NOT redundant with a coarse pointer. A TV remote and
 * a kiosk D-pad are both coarse pointers with no touchscreen behind them, and
 * an on-screen thumb pad is useless to both -- they already have the keyboard
 * and gamepad paths.
 *
 * This is only the SEED. It is permissive on purpose and it is allowed to be
 * wrong: useTouchControls corrects it from what the player actually does, which
 * is the only signal no device can lie about.
 */
export function wantsTouchControls(caps: PointerCapabilities): boolean {
  return caps.maxTouchPoints > 0 && caps.primaryCoarse;
}

/** Read the capabilities off a real window. The only DOM access in this file. */
export function readPointerCapabilities(win: Window): PointerCapabilities {
  return {
    maxTouchPoints: win.navigator?.maxTouchPoints ?? 0,
    primaryCoarse:
      typeof win.matchMedia === "function" ? win.matchMedia("(pointer: coarse)").matches : false,
  };
}

/**
 * Did this pointer come from something other than a mouse?
 *
 * A pen counts. On a tablet whose stylus is the main way in, the on-screen
 * controls are exactly as necessary as they are for a finger.
 */
export function isTouchPointer(pointerType: string): boolean {
  return pointerType === "touch" || pointerType === "pen";
}
