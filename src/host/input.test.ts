import { describe, expect, it } from "vitest";
import { Button, isHeld, isPressed } from "@/engine/core/input";
import { InputSource, isGameKey } from "./input";

/**
 * THE ON-SCREEN BUTTON PLUMBING.
 *
 * These assertions exist because the thing they cover cannot be checked in a
 * browser on this machine: desktop Chrome's device emulation advertises five
 * touch points and delivers one, so "hold RIGHT and press JUMP at the same
 * time" - the single most important gesture in the game - is not reproducible
 * outside a real tablet. What IS reproducible is that the input source packs
 * two simultaneous virtual buttons correctly, and that a tap shorter than a sim
 * tick still registers. So that is what is pinned here.
 *
 * No DOM: vitest runs in the `node` environment, and none of this needs one.
 */

describe("virtual buttons", () => {
  it("holds two at once, so a moving player can jump", () => {
    const input = new InputSource();
    input.setVirtual(Button.RIGHT, true);
    input.setVirtual(Button.A, true);

    const frame = input.consume();
    expect(isHeld(frame, Button.RIGHT)).toBe(true);
    expect(isHeld(frame, Button.A)).toBe(true);
  });

  it("produces a press edge the first tick a button goes down", () => {
    const input = new InputSource();
    input.setVirtual(Button.A, true);
    expect(isPressed(input.consume(), Button.A)).toBe(true);
  });

  it("does not repeat the edge while the button stays down", () => {
    // Otherwise a held JUMP would re-fire every tick and the player bounces.
    const input = new InputSource();
    input.setVirtual(Button.A, true);
    input.consume();
    expect(isPressed(input.consume(), Button.A)).toBe(false);
  });

  it("keeps a tap that begins and ends between two ticks", () => {
    // On a 144 Hz display most rendered frames run no sim tick at all. Without
    // the latch the player taps jump and nothing happens - intermittently, which
    // is the worst way for it to fail.
    const input = new InputSource();
    input.setVirtual(Button.A, true);
    input.setVirtual(Button.A, false);

    const frame = input.consume();
    expect(isPressed(frame, Button.A)).toBe(true);
    // ...and it reads as already released, so variable jump height still works.
    expect(isHeld(frame, Button.A)).toBe(false);
  });

  it("clearVirtual drops a stuck button", () => {
    // The recovery path for a pointerup that never arrived because the tab was
    // backgrounded mid-press.
    const input = new InputSource();
    input.setVirtual(Button.A, true);
    input.consume();
    input.clearVirtual();
    expect(isHeld(input.consume(), Button.A)).toBe(false);
  });

  it("re-presses cleanly after being cleared", () => {
    const input = new InputSource();
    input.setVirtual(Button.A, true);
    input.consume();
    input.clearVirtual();
    input.consume();

    input.setVirtual(Button.A, true);
    expect(isPressed(input.consume(), Button.A)).toBe(true);
  });

  it("releaseKeys leaves a finger that is still on the glass alone", () => {
    const input = new InputSource();
    input.setVirtual(Button.A, true);
    input.releaseKeys();
    expect(isHeld(input.consume(), Button.A)).toBe(true);
  });
});

describe("isGameKey", () => {
  it("recognises the jump keys", () => {
    for (const code of ["Space", "KeyZ", "KeyK"]) {
      expect(isGameKey(code)).toBe(true);
    }
  });

  it("ignores keys the game does not bind", () => {
    // The touch overlay hides itself on a game keypress. Tab and Escape must
    // not count, or assistive navigation would take the buttons away.
    for (const code of ["Tab", "Escape", "F1", "KeyQ"]) {
      expect(isGameKey(code)).toBe(false);
    }
  });

  it("is not fooled by inherited object properties", () => {
    expect(isGameKey("toString")).toBe(false);
    expect(isGameKey("constructor")).toBe(false);
  });
});
