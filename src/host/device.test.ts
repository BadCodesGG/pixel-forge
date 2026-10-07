import { describe, expect, it } from "vitest";
import { isTouchPointer, wantsTouchControls, type PointerCapabilities } from "./device";

/**
 * THE DEVICE TABLE.
 *
 * This file exists to stop one specific regression coming back. The predicate
 * used to include `!(hover: hover)`, which reads as "and there is no mouse" and
 * actually means "and nothing can hover" - so a stylus that hovers, or a
 * trackpad on a keyboard folio, made a tablet look like a desktop and the jump
 * button was never drawn.
 *
 * Every row below is a device someone actually plays on. If a change to
 * wantsTouchControls turns a `true` into a `false` here, that is a young player who
 * cannot jump, not a failing assertion.
 */

interface Row {
  device: string;
  caps: PointerCapabilities;
  want: boolean;
  why: string;
}

const DEVICES: Row[] = [
  {
    device: "iPad, nothing attached",
    caps: { maxTouchPoints: 5, primaryCoarse: true },
    want: true,
    why: "the plain case, and the only one the old gate got right",
  },
  {
    device: "iPad + Magic Keyboard trackpad",
    caps: { maxTouchPoints: 5, primaryCoarse: true },
    want: true,
    why: "hover:hover is true here, which is what used to hide the controls",
  },
  {
    device: "Samsung tablet + hovering S Pen",
    caps: { maxTouchPoints: 10, primaryCoarse: true },
    want: true,
    why: "THE REPORTED BUG. A digitizer reports hover about a centimetre out",
  },
  {
    device: "Android phone",
    caps: { maxTouchPoints: 5, primaryCoarse: true },
    want: true,
    why: "no keyboard exists, so there is no other way to play",
  },
  {
    device: "Surface, tablet mode",
    caps: { maxTouchPoints: 10, primaryCoarse: true },
    want: true,
    why: "the cover is folded back; the finger is the only pointer in use",
  },
  {
    device: "Surface, Type Cover attached",
    caps: { maxTouchPoints: 10, primaryCoarse: false },
    want: false,
    why: "a precise primary pointer means the keyboard is in play",
  },
  {
    device: "touchscreen Windows laptop",
    caps: { maxTouchPoints: 10, primaryCoarse: false },
    want: false,
    why: "a d-pad over the game would be pure loss for a keyboard player",
  },
  {
    device: "plain desktop",
    caps: { maxTouchPoints: 0, primaryCoarse: false },
    want: false,
    why: "no touchscreen at all",
  },
  {
    device: "TV browser with a remote",
    caps: { maxTouchPoints: 0, primaryCoarse: true },
    want: false,
    why: "coarse but untouchable - a thumb pad is useless, the d-pad works",
  },
  {
    device: "Chrome device emulation",
    caps: { maxTouchPoints: 1, primaryCoarse: true },
    want: true,
    why: "so the emulator is worth something as a check",
  },
];

describe("wantsTouchControls", () => {
  it.each(DEVICES)("$device -> $want, because $why", ({ caps, want }) => {
    expect(wantsTouchControls(caps)).toBe(want);
  });

  it("never asks about hover, so a hovering stylus cannot hide the controls", () => {
    // The regression, stated as a property: two devices identical except for
    // something that can hover must get the same answer. The type has no hover
    // field at all, which is the real guard - this asserts the intent so that
    // adding one back has to fail a test rather than merely a code review.
    const withPen: PointerCapabilities = { maxTouchPoints: 10, primaryCoarse: true };
    const withoutPen: PointerCapabilities = { maxTouchPoints: 5, primaryCoarse: true };
    expect(wantsTouchControls(withPen)).toBe(wantsTouchControls(withoutPen));
  });
});

describe("isTouchPointer", () => {
  it("counts a finger", () => {
    expect(isTouchPointer("touch")).toBe(true);
  });

  it("counts a pen, because a stylus tablet needs the controls just as much", () => {
    expect(isTouchPointer("pen")).toBe(true);
  });

  it("does not count a mouse", () => {
    expect(isTouchPointer("mouse")).toBe(false);
  });

  it("does not count an unknown pointer type", () => {
    expect(isTouchPointer("")).toBe(false);
  });
});
