import { Button, makeInput, type ButtonId, type InputFrame } from "@/engine/core/input";

/**
 * KEYBOARD AND GAMEPAD -> InputFrame.
 *
 * This is the host side of the input boundary: it touches the DOM, so it lives
 * outside src/engine. It collects raw events continuously and hands the sim
 * exactly one immutable frame per tick.
 */

/**
 * Exported because the controls guide documents these bindings, and a test
 * pins the guide's text to this table. That test is the reason the help line
 * cannot go stale the way "ARROWS MOVE - SPACE JUMP" did.
 */
export const KEY_BINDINGS: Record<string, ButtonId> = {
  ArrowLeft: Button.LEFT,
  KeyA: Button.LEFT,
  ArrowRight: Button.RIGHT,
  KeyD: Button.RIGHT,
  ArrowUp: Button.UP,
  KeyW: Button.UP,
  ArrowDown: Button.DOWN,
  KeyS: Button.DOWN,
  Space: Button.A,
  KeyZ: Button.A,
  KeyK: Button.A,
  ShiftLeft: Button.B,
  ShiftRight: Button.B,
  KeyX: Button.B,
  KeyJ: Button.B,
  // START is bound here and read NOWHERE. There is no pause: nothing in
  // src/engine calls isPressed(input, Button.START). Enter reaches the editor's
  // own key handler instead. Left in place for when a pause exists, so do not
  // go looking for the handler - there isn't one.
  Enter: Button.START,
};

/** Standard-mapping gamepad button indices -> our buttons. */
export const PAD_BUTTONS: Record<number, ButtonId> = {
  0: Button.A, // A / Cross
  1: Button.B, // B / Circle
  2: Button.B, // X / Square - run on either face button
  3: Button.A, // Y / Triangle
  9: Button.START, // read by nothing yet; see the note on Enter above
  12: Button.UP,
  13: Button.DOWN,
  14: Button.LEFT,
  15: Button.RIGHT,
};

/**
 * Does this KeyboardEvent.code drive the game?
 *
 * One definition, because two things ask: this class, and the touch overlay,
 * which treats a game keypress as proof that a real keyboard is being used and
 * hides itself. Restricting it to bound keys means Tab, Escape and assistive
 * shortcuts do not count as "the player picked up a keyboard".
 */
export function isGameKey(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(KEY_BINDINGS, code);
}

const STICK_DEADZONE = 0.4;

export class InputSource {
  private held = new Set<ButtonId>();
  /** Presses seen since the last `consume()`. Cleared every tick. */
  private pressedLatch = new Set<ButtonId>();
  private padHeld = new Set<ButtonId>();
  private padPrev = new Set<ButtonId>();
  /**
   * On-screen buttons.
   *
   * Kept in their own set, not merged into `held`, so a blur or focus loss can
   * clear the KEYBOARD without also releasing a finger that is still pressing
   * the screen.
   */
  private virtualHeld = new Set<ButtonId>();
  private detached: Array<() => void> = [];

  /** True once any gamepad button has been touched, for the connect prompt. */
  gamepadSeen = false;

  /**
   * True while a menu owns the keyboard. Set by GameLoop.setPaused.
   *
   * WHAT THIS FIXES. These listeners are on `window` and have no idea a dialog
   * is open - the [role="dialog"] guard belongs to the EDITOR's key handler,
   * not to this one. Space and Enter are both bound, so with the loop running a
   * focused button inside a dialog could never be activated: this class ate the
   * keystroke and the player jumped instead. It went unnoticed because every
   * dialog until the controls guide was reachable only from build mode, where
   * the loop is stopped.
   */
  suspended = false;

  attach(target: Window): void {
    const onKeyDown = (e: KeyboardEvent) => {
      // Before preventDefault, so a suspended source is transparent rather than
      // merely silent - a dialog's own Space and Enter must still work.
      if (this.suspended) return;
      const button = KEY_BINDINGS[e.code];
      if (button === undefined) return;
      // Arrows and space scroll the page; a game must not.
      e.preventDefault();
      // Auto-repeat fires keydown continuously while a key is held. Letting it
      // through would re-trigger every press-edge action many times a second.
      if (e.repeat) return;
      this.held.add(button);
      this.pressedLatch.add(button);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (this.suspended) return;
      const button = KEY_BINDINGS[e.code];
      if (button === undefined) return;
      e.preventDefault();
      this.held.delete(button);
    };

    // THE CLASSIC BUG THIS PREVENTS: keyup is never delivered once the window
    // loses focus, so alt-tabbing mid-run leaves the character sprinting into
    // a wall forever. Clearing everything on blur is the fix, and it has to
    // cover visibilitychange too: switching tabs does not always fire blur.
    const releaseAll = () => this.releaseKeys();
    const onVisibility = () => {
      if (document.hidden) releaseAll();
    };

    target.addEventListener("keydown", onKeyDown, { passive: false });
    target.addEventListener("keyup", onKeyUp, { passive: false });
    target.addEventListener("blur", releaseAll);
    target.document.addEventListener("visibilitychange", onVisibility);

    this.detached = [
      () => target.removeEventListener("keydown", onKeyDown),
      () => target.removeEventListener("keyup", onKeyUp),
      () => target.removeEventListener("blur", releaseAll),
      () => target.document.removeEventListener("visibilitychange", onVisibility),
    ];
  }

  detach(): void {
    for (const fn of this.detached) fn();
    this.detached = [];
  }

  /**
   * Drop everything the keyboard and gamepad are holding.
   *
   * NOT the virtual set - see the note on `virtualHeld`. A finger that is still
   * on the glass has not let go just because the window lost focus.
   */
  releaseKeys(): void {
    this.held.clear();
    this.pressedLatch.clear();
    this.padHeld.clear();
    this.padPrev.clear();
  }

  /**
   * Poll connected gamepads.
   *
   * `navigator.getGamepads()` returns SNAPSHOTS: the objects are stale the
   * moment you store them, so this must re-read the array every tick rather
   * than caching whatever the `gamepadconnected` event handed over.
   */
  private pollGamepads(): void {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return;
    this.padPrev = new Set(this.padHeld);
    this.padHeld.clear();

    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      for (const [indexText, button] of Object.entries(PAD_BUTTONS)) {
        if (pad.buttons[Number(indexText)]?.pressed) {
          this.padHeld.add(button);
          this.gamepadSeen = true;
        }
      }
      // Left stick as a fallback for pads whose d-pad is reported as an axis.
      const [ax = 0, ay = 0] = pad.axes;
      if (ax < -STICK_DEADZONE) this.padHeld.add(Button.LEFT);
      if (ax > STICK_DEADZONE) this.padHeld.add(Button.RIGHT);
      if (ay < -STICK_DEADZONE) this.padHeld.add(Button.UP);
      if (ay > STICK_DEADZONE) this.padHeld.add(Button.DOWN);
    }

    // A pad press is an edge only if it was not down last poll.
    for (const button of this.padHeld) {
      if (!this.padPrev.has(button)) this.pressedLatch.add(button);
    }
  }

  /**
   * Produce one frame and clear the press latch.
   *
   * Called exactly once per SIM TICK, not once per rendered frame. On a 144 Hz
   * display most rendered frames run no tick at all, so a tap that begins and
   * ends between two ticks would be lost entirely without the latch: the
   * player presses jump and nothing happens.
   */
  /**
   * Set an on-screen button's state. Called by the touch overlay.
   *
   * THE EDGE IS LATCHED HERE, AT THE EVENT - not diffed in `consume()` the way
   * the gamepad's is. That distinction is load-bearing and it was wrong once.
   *
   * `consume()` runs once per SIM TICK, and a tick only happens when the
   * accumulator has filled: on a 144 Hz display most rendered frames run none
   * at all. Diffing there can only ever see buttons that are STILL down when a
   * tick arrives, so a tap that began and ended in the ~16 ms between two ticks
   * left no trace whatsoever. The player taps jump, nothing happens, and it does
   * it intermittently - which is the worst way for a control to fail.
   *
   * A gamepad has to be diffed because polling is the only signal it offers.
   * A touch button is an event, exactly like a key, so it latches like a key.
   *
   * The `has` guard matters: the d-pad calls this on every pointermove while a
   * thumb slides, so without it a single held direction would re-fire an edge
   * many times a second.
   */
  setVirtual(button: ButtonId, down: boolean): void {
    if (down) {
      if (!this.virtualHeld.has(button)) this.pressedLatch.add(button);
      this.virtualHeld.add(button);
    } else {
      this.virtualHeld.delete(button);
    }
  }

  clearVirtual(): void {
    this.virtualHeld.clear();
  }

  consume(): InputFrame {
    this.pollGamepads();

    const held = [...this.held, ...this.padHeld, ...this.virtualHeld];
    const pressed = [...this.pressedLatch];
    this.pressedLatch.clear();
    return makeInput(held, pressed);
  }
}
