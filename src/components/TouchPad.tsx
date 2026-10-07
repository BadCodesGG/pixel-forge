"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Button, type ButtonId } from "@/engine/core/input";
import { isGameKey, type InputSource } from "@/host/input";
import { isTouchPointer, readPointerCapabilities, wantsTouchControls } from "@/host/device";
import { SIZE, TOUCH, TYPE, UI, toneStyle, type Tone } from "@/design/tokens";
import { Icon } from "./ui/Icon";
import { ActionButton } from "./ui/Controls";

/**
 * ON-SCREEN CONTROLS.
 *
 * Pointer Events rather than touch events, so one code path covers finger,
 * stylus and mouse.
 *
 * ---------------------------------------------------------------------------
 * THE THINGS THAT MAKE TOUCH CONTROLS BEARABLE
 * ---------------------------------------------------------------------------
 * 1. POINTER CAPTURE, AND TRACKING SLIDES. A thumb does not stay inside a
 *    circle while the player is concentrating on a jump. Sliding off the d-pad
 *    must keep steering, so the pad tracks the pointer's POSITION rather than
 *    which element it started on.
 *
 * 2. THE BUTTONS SIT OVER THE GAME, NOT BESIDE IT. Shrinking the play area to
 *    make room would cost exactly the thing being played.
 *
 * 3. `touch-action: none`. Without it the browser hijacks a drag as a scroll
 *    or a pinch mid-jump, which feels like the game freezing.
 *
 * 4. THE INPUT PATH IS THE SAME ONE. These write into the same held-button set
 *    the keyboard and gamepad use, so the simulation cannot tell the difference
 *    and no input source gets its own bugs.
 *
 * 5. NOTHING ELSE MAY OCCUPY THE BOTTOM CORNERS. This is the one that was
 *    broken. The play dock used to sit bottom-right, one layer above these, and
 *    covered 66 of the jump button's 76 pixels - so a tablet player's jump
 *    pressed "Build" and left the game. See PlayControls in Editor.tsx, which
 *    moves out of the way whenever these are up.
 */

// ---------------------------------------------------------------------------
// Is this device being played with a thumb?
// ---------------------------------------------------------------------------

const OVERRIDE_KEY = "pf.touchControls";
const COACH_KEY = "pf.coach.v1";
/** How long the first-run labels stay up if the player does nothing at all. */
const COACH_MS = 10_000;

/** null means "follow detection". The player can say otherwise. */
export type TouchOverride = "on" | "off" | null;

export interface TouchControls {
  /** Show the on-screen pad, and move the play chrome out of its way. */
  active: boolean;
  /** What the device alone suggests, ignoring the override. */
  detected: boolean;
  override: TouchOverride;
  setOverride: (value: TouchOverride) => void;
  /** Short viewport - use the smaller pad so it does not eat the level. */
  compact: boolean;
}

function readStored<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return allowed.includes(raw as T) ? (raw as T) : null;
  } catch {
    // Private mode, or storage disabled. Detection alone still works.
    return null;
  }
}

/**
 * Whether to draw on-screen controls, and how big.
 *
 * ---------------------------------------------------------------------------
 * THREE SIGNALS, IN INCREASING ORDER OF AUTHORITY
 * ---------------------------------------------------------------------------
 * 1. THE SEED, from the device's own capabilities. Permissive on purpose - see
 *    wantsTouchControls in src/host/device.ts for the media query that used to
 *    be here and why it made jumping impossible on a stylus tablet. It runs in
 *    a lazy initializer rather than an effect because this tree is client-only
 *    (`ssr: false` in EditorShell), so `window` exists on the first render and
 *    a real tablet gets its buttons on the first painted frame of play rather
 *    than one render later.
 *
 * 2. LAST INPUT WINS, at runtime, in both directions. A finger or a stylus
 *    proves there is a touchscreen in use even when the media queries say
 *    otherwise; a bound keypress proves there is a keyboard in use, which is
 *    the only thing that makes the pad unnecessary. This is the rule every
 *    console-and-PC game uses, and it is what rescues the devices whose
 *    capabilities are simply wrong. Deliberately no hysteresis: a player who
 *    just touched the screen wants the buttons NOW, not in half a second.
 *
 * 3. THE OVERRIDE, if the player set one. The safety valve: it turns any future
 *    detection miss on a device nobody owns from a dead end into one tap in the
 *    controls guide.
 */
export function useTouchControls(): TouchControls {
  const [detected, setDetected] = useState(
    () => typeof window !== "undefined" && wantsTouchControls(readPointerCapabilities(window)),
  );
  const [override, setOverrideState] = useState<TouchOverride>(() =>
    typeof window === "undefined" ? null : readStored(OVERRIDE_KEY, ["on", "off"] as const),
  );
  const [compact, setCompact] = useState(
    () => typeof window !== "undefined" && window.innerHeight < TOUCH.compactHeight,
  );

  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    // Docking a keyboard folio, pairing a mouse, or a stylus waking all fire
    // this. The old code read the device once and could never recover.
    const reseed = () => setDetected(wantsTouchControls(readPointerCapabilities(window)));
    const onPointerDown = (e: PointerEvent) => {
      if (isTouchPointer(e.pointerType)) setDetected(true);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // Keys pressed while a panel is open are menu navigation, not gameplay.
      // Without this, using Space to activate the guide's own "Got it" button
      // reads as "this player has a keyboard" and takes the jump button away -
      // which is a rather pointed way to end a visit to the help screen. Same
      // guard, and the same reasoning, as the Editor's global key handler.
      if (document.querySelector('[role="dialog"]')) return;
      if (isGameKey(e.code)) setDetected(false);
    };
    const onResize = () => setCompact(window.innerHeight < TOUCH.compactHeight);

    // RE-READ ON MOUNT, not just on the next event.
    //
    // The lazy initializers above run when this component first renders, and
    // EditorShell loads it through a dynamic import - so anything that changed
    // the window between the module resolving and this effect attaching was
    // missed, and the wrong value would have stuck until the next resize. That
    // is precisely the read-once-never-recover shape that made a tablet
    // unjumpable in the first place; it is not worth being clever about.
    reseed();
    onResize();

    // Capture phase, so no stopPropagation added later can hide these from us,
    // and passive, so watching a press can never delay one.
    media.addEventListener("change", reseed);
    window.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("resize", onResize);
    // Rotating a tablet and a phone's URL bar sliding away both move the usable
    // height without always producing a window `resize`.
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      media.removeEventListener("change", reseed);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true });
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
  }, []);

  const setOverride = useCallback((value: TouchOverride) => {
    setOverrideState(value);
    try {
      if (value === null) window.localStorage.removeItem(OVERRIDE_KEY);
      else window.localStorage.setItem(OVERRIDE_KEY, value);
    } catch {
      // Not persisted, but honoured for this session, which is the case that
      // matters to someone who cannot play right now.
    }
  }, []);

  return {
    active: override === null ? detected : override === "on",
    detected,
    override,
    setOverride,
    compact,
  };
}

// ---------------------------------------------------------------------------
// The overlay
// ---------------------------------------------------------------------------

/**
 * A first-run label, pinned above the control it describes.
 *
 * Rendered INSIDE this component rather than as a separate overlay, which is
 * the entire justification for a coach over a picture in the guide: a callout
 * laid out next to the real button cannot drift away from it, and it proves the
 * button is there - which is exactly the thing a stuck player doubts.
 */
function CoachChip({ children }: { children: ReactNode }) {
  return (
    <span
      className="pf-pop"
      style={{
        ...toneStyle("warn"),
        boxShadow: "var(--pf-shadow)",
        padding: "5px 9px",
        fontFamily: TYPE.ui,
        fontSize: TYPE.tiny,
        fontWeight: TYPE.tinyWeight,
        letterSpacing: "0.06em",
        whiteSpace: "nowrap",
        // A coach that swallows the first jump would be a worse version of the
        // bug this whole change exists to fix.
        pointerEvents: "none",
      }}
    >
      {children}
    </span>
  );
}

/** One control and its optional label, stacked. */
function Cluster({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: SIZE.gap,
        pointerEvents: "none",
      }}
    >
      {label}
      {children}
    </div>
  );
}

export function TouchPad({
  input,
  visible,
  compact,
}: {
  input: InputSource | null;
  visible: boolean;
  compact: boolean;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  /** Pointer ids currently held on each control, so multi-touch works. */
  const activeRef = useRef(new Map<number, "pad" | ButtonId>());

  const [coachDone, setCoachDone] = useState(
    () => typeof window === "undefined" || readStored(COACH_KEY, ["1"] as const) === "1",
  );

  const dismissCoach = useCallback(() => {
    setCoachDone(true);
    try {
      window.localStorage.setItem(COACH_KEY, "1");
    } catch {
      // Shown again next time. Harmless.
    }
  }, []);

  /**
   * Let everything go.
   *
   * THE STUCK-BUTTON BUG THIS PREVENTS: `pointerup` is not delivered when the
   * OS backgrounds the tab mid-press - pulling down Control Centre while
   * holding JUMP does it - so the button stays held right through the return
   * and the character launches on their own. InputSource.releaseKeys
   * deliberately leaves the virtual set alone (a finger on the glass has not
   * let go just because the window blurred), so the overlay clears its own.
   */
  const releaseEverything = useCallback(() => {
    activeRef.current.clear();
    input?.clearVirtual();
  }, [input]);

  useEffect(() => {
    if (!visible) {
      releaseEverything();
      return;
    }
    const onHidden = () => {
      if (document.hidden) releaseEverything();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", releaseEverything);
    window.addEventListener("blur", releaseEverything);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", releaseEverything);
      window.removeEventListener("blur", releaseEverything);
      releaseEverything();
    };
  }, [visible, releaseEverything]);

  useEffect(() => {
    if (coachDone || !visible) return;
    const timer = window.setTimeout(dismissCoach, COACH_MS);
    return () => window.clearTimeout(timer);
  }, [coachDone, visible, dismissCoach]);

  if (!visible || !input) return null;

  const padSize = compact ? TOUCH.padCompact : TOUCH.pad;
  const buttonSize = compact ? TOUCH.buttonCompact : TOUCH.button;
  const arrow = compact ? SIZE.iconSmall : SIZE.iconLarge;
  const coaching = !coachDone;

  /** Translate a point inside the d-pad into up to two direction presses. */
  const applyPad = (clientX: number, clientY: number) => {
    const el = padRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = clientX - (r.left + r.width / 2);
    const dy = clientY - (r.top + r.height / 2);
    // A dead zone stops a resting thumb from drifting the character.
    input.setVirtual(Button.LEFT, dx < -TOUCH.padDead);
    input.setVirtual(Button.RIGHT, dx > TOUCH.padDead);
    input.setVirtual(Button.UP, dy < -TOUCH.padDead);
    input.setVirtual(Button.DOWN, dy > TOUCH.padDead);
  };

  const clearPad = () => {
    input.setVirtual(Button.LEFT, false);
    input.setVirtual(Button.RIGHT, false);
    input.setVirtual(Button.UP, false);
    input.setVirtual(Button.DOWN, false);
  };

  const endPad = (e: ReactPointerEvent<HTMLDivElement>) => {
    activeRef.current.delete(e.pointerId);
    clearPad();
  };

  /**
   * Suppress everything the OS would rather do with a long press.
   *
   * Holding JUMP is how you jump HIGH, and on iOS a long press raises the
   * callout and the text magnifier, either of which cancels the pointer stream
   * and drops the character mid-arc.
   */
  const noLongPress = {
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
    WebkitTapHighlightColor: "transparent",
    // Inline, because .pf-press sets `manipulation` and a drag off a face
    // button has to stay a drag rather than becoming a scroll.
    touchAction: "none",
  } as const;

  const faceButton = (button: ButtonId, label: string, tone: Tone, name: string) => {
    const release = (e: ReactPointerEvent<HTMLDivElement>) => {
      activeRef.current.delete(e.pointerId);
      input.setVirtual(button, false);
      e.currentTarget.removeAttribute("data-sunk");
    };

    return (
      <div
        role="button"
        aria-label={name}
        className="pf-press"
        onPointerDown={(e) => {
          // THE PRESS FIRST, THE CAPTURE SECOND. setPointerCapture throws when
          // the pointer is no longer active - a fast double-tap does it - and
          // when that throw came first it ate the jump outright.
          activeRef.current.set(e.pointerId, button);
          input.setVirtual(button, true);
          e.currentTarget.dataset.sunk = "true";
          // Jumping is proof they have understood the labels.
          if (button === Button.A) dismissCoach();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // The press still counts; only the slide-off tracking is lost.
          }
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          ...toneStyle(tone),
          ...noLongPress,
          pointerEvents: "auto",
          width: buttonSize,
          height: buttonSize,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: TYPE.ui,
          fontSize: TYPE.label,
          fontWeight: TYPE.labelWeight,
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </div>
    );
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        // The base gap and the safe-area inset are on TWO different boxes on
        // purpose: env() inside calc() is dropped WHOLE by a browser that does
        // not know env(), which would take the base padding with it and land
        // the d-pad under a rounded screen corner.
        padding: TOUCH.edge,
        pointerEvents: "none",
        touchAction: "none",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          // viewportFit:"cover" puts the world under the notch and the home
          // bar, so without these a third of LEFT is untappable on an iPad.
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
        }}
      >
        <Cluster label={coaching ? <CoachChip>SLIDE TO MOVE</CoachChip> : null}>
          <div
            ref={padRef}
            aria-label="Move"
            role="button"
            onPointerDown={(e) => {
              activeRef.current.set(e.pointerId, "pad");
              applyPad(e.clientX, e.clientY);
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                // Steering still works; it just stops at the edge of the pad.
              }
            }}
            onPointerMove={(e) => {
              // Keep steering even when the thumb has slid outside the square.
              if (activeRef.current.get(e.pointerId) === "pad") applyPad(e.clientX, e.clientY);
            }}
            onPointerUp={endPad}
            onPointerCancel={endPad}
            onLostPointerCapture={endPad}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              ...toneStyle("neutral"),
              ...noLongPress,
              boxShadow: "var(--pf-shadow)",
              pointerEvents: "auto",
              width: padSize,
              height: padSize,
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gridTemplateRows: "1fr 1fr 1fr",
              placeItems: "center",
              color: UI.textSoft,
            }}
          >
            <span />
            <Icon name="up" size={arrow} />
            <span />
            <Icon name="left" size={arrow} />
            <span />
            <Icon name="right" size={arrow} />
            <span />
            <Icon name="down" size={arrow} />
            <span />
          </div>
        </Cluster>

        {coaching && (
          <div style={{ pointerEvents: "auto", paddingBottom: SIZE.gap }}>
            <ActionButton icon="tick" label="Got it" onClick={dismissCoach} tone="go" />
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-end", gap: TOUCH.buttonGap }}>
          <Cluster label={coaching ? <CoachChip>HOLD TO RUN</CoachChip> : null}>
            {faceButton(Button.B, "RUN", "warn", "Run")}
          </Cluster>
          <Cluster label={coaching ? <CoachChip>TAP TO JUMP</CoachChip> : null}>
            {faceButton(Button.A, "JUMP", "go", "Jump")}
          </Cluster>
        </div>
      </div>
    </div>
  );
}
