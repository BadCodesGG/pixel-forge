"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { SIZE, TYPE, UI, toneStyle, type PixelStyle, type Tone } from "@/design/tokens";
import { drawPartArt } from "@/host/partArt";
import { audio } from "@/host/audio";

/**
 * THE CONTROL VOCABULARY.
 *
 * Five shapes, and every control in the interface is one of them:
 *
 *   ToolButton   - a mode you are IN. Big, icon over label, obviously selected.
 *   ActionButton - a thing that happens once when you press it.
 *   IconButton   - the same, where the icon alone is unambiguous.
 *   PlayButton   - the one button that matters most, so it gets its own size.
 *   PartButton   - a piece of the world. Shows the ACTUAL sprite.
 *
 * Keeping the vocabulary this small is the point. When every control is one of
 * a few familiar shapes, a young player learns the interface once instead of learning
 * each button, and nothing new is ever a surprise.
 *
 * ===========================================================================
 * HOW A PIXEL BUTTON IS BUILT
 * ===========================================================================
 * `bevel()` in src/design/tokens.ts supplies the face colour, the 3px sprite
 * outline, and two box-shadow recipes handed to CSS as custom properties. The
 * `.pf-press` rule in globals.css chooses between them on :hover / :active /
 * [data-sunk]. Pressed swaps the highlight and the lowlight, so the bevel
 * INVERTS and the button visibly goes in rather than merely changing colour.
 *
 * Sizes and colours are real values from tokens, not Tailwind classes. That is
 * a deliberate reversal of the usual default, for one concrete reason: an audit
 * of the rendered page once found controls at 19-26px against this system's own
 * 44px minimum, because the utility classes had not been generated. A design
 * system whose dimensions depend on a build step silently degrading is not a
 * design system - and "the button is too small for a young player to hit" is exactly
 * the kind of failure that is invisible in review and obvious in a young player's
 * hands.
 */

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

type Chirp = "click" | "select" | "deny";

/**
 * Every control's press goes through here.
 *
 * Wiring it once means "buttons make a noise" is a property of the vocabulary
 * rather than something forty call sites have to remember - which is how
 * `audio.click()` came to exist for months with no callers at all.
 *
 * `unlock()` first: this runs inside a real user gesture, which is the only
 * moment a browser will start an AudioContext, and it is idempotent after the
 * first call. A useful side effect is that audio is already alive by the time
 * the player reaches the Play button.
 */
function chirp(kind: Chirp): void {
  audio.unlock();
  if (kind === "select") audio.select();
  else if (kind === "deny") audio.deny();
  else audio.click();
}

/**
 * Bound to pointerdown, not click.
 *
 * A game button sounds when it goes DOWN; leading the action by a few tens of
 * milliseconds is most of what makes a control feel responsive. A disabled
 * control receives no pointer events at all, so staying silent when there is
 * nothing to do is free rather than a special case.
 */
function pressSound(kind: Chirp) {
  return () => chirp(kind);
}

// ---------------------------------------------------------------------------
// Shared geometry
// ---------------------------------------------------------------------------

const centred: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
  fontFamily: TYPE.ui,
  padding: 0,
};

const labelStyle: CSSProperties = {
  fontSize: TYPE.tiny,
  fontWeight: TYPE.tinyWeight,
  letterSpacing: "0.02em",
  whiteSpace: "nowrap",
};

/** The 1-5 hint in the corner of a tool. Small, dim, and never in the way. */
function KeyHint({ hint }: { hint: string }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        top: 2,
        left: 4,
        fontFamily: TYPE.display,
        fontSize: 8,
        opacity: 0.5,
        pointerEvents: "none",
      }}
    >
      {hint}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

/**
 * A mode you are in: draw, rub out, place the start flag.
 *
 * Selection is signalled FOUR ways at once - the face changes colour, the bevel
 * inverts, the whole button sinks, and it gains a gold lit edge. Redundancy is
 * the requirement, not excess: one signal is easy to miss mid-task, and "which
 * tool am I holding?" is the question a young player asks most often.
 */
export function ToolButton(props: {
  icon: IconName;
  label: string;
  selected?: boolean;
  onClick: () => void;
  title?: string;
  tone?: Tone;
  disabled?: boolean;
  /** Keyboard shortcut shown in the corner. */
  hint?: string;
}) {
  const on = !!props.selected;
  const style: PixelStyle = {
    ...centred,
    ...toneStyle(props.tone ?? "neutral", on),
    position: "relative",
    flexDirection: "column",
    gap: 3,
    width: SIZE.toolButton,
    height: SIZE.toolButton,
  };

  return (
    <button
      type="button"
      onClick={props.onClick}
      onPointerDown={pressSound(props.disabled ? "deny" : "select")}
      title={props.title}
      disabled={props.disabled}
      aria-pressed={props.selected}
      className="pf-press"
      style={style}
    >
      {props.hint && <KeyHint hint={props.hint} />}
      <Icon name={props.icon} size={SIZE.iconLarge} />
      <span style={labelStyle}>{props.label}</span>
    </button>
  );
}

/** Something that happens once: save, back up, delete. */
export function ActionButton(props: {
  icon: IconName;
  label: string;
  onClick: () => void;
  title?: string;
  tone?: Tone;
  disabled?: boolean;
  wide?: boolean;
}) {
  const style: PixelStyle = {
    ...centred,
    ...toneStyle(props.tone ?? "neutral"),
    gap: 8,
    height: SIZE.actionButton,
    padding: props.wide ? "0 20px" : "0 14px",
  };

  return (
    <button
      type="button"
      onClick={props.onClick}
      onPointerDown={pressSound(props.disabled ? "deny" : "click")}
      title={props.title}
      disabled={props.disabled}
      className="pf-press"
      style={style}
    >
      <Icon name={props.icon} size={SIZE.iconSmall} />
      <span
        style={{
          ...labelStyle,
          fontSize: props.wide ? TYPE.body : TYPE.label,
          fontWeight: TYPE.labelWeight,
        }}
      >
        {props.label}
      </span>
    </button>
  );
}

/** A square icon-only control, for dock corners where the glyph is unambiguous. */
export function IconButton(props: {
  icon: IconName;
  label: string;
  onClick: () => void;
  tone?: Tone;
  selected?: boolean;
  disabled?: boolean;
}) {
  const style: PixelStyle = {
    ...centred,
    ...toneStyle(props.tone ?? "neutral", !!props.selected),
    width: SIZE.actionButton,
    height: SIZE.actionButton,
  };

  return (
    <button
      type="button"
      onClick={props.onClick}
      onPointerDown={pressSound(props.disabled ? "deny" : "click")}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.selected}
      disabled={props.disabled}
      className="pf-press"
      style={style}
    >
      <Icon name={props.icon} size={SIZE.iconSmall} />
    </button>
  );
}

/** The one button that matters most, so it gets its own size and the display face. */
export function PlayButton(props: { onClick: () => void; playing: boolean; title?: string }) {
  const style: PixelStyle = {
    ...centred,
    ...toneStyle(props.playing ? "neutral" : "go", false, SIZE.shadow + 1),
    gap: 10,
    height: SIZE.toolButton,
    padding: "0 20px",
  };

  return (
    <button
      type="button"
      onClick={props.onClick}
      onPointerDown={pressSound("click")}
      title={props.title}
      className="pf-press"
      style={style}
    >
      <Icon name={props.playing ? "stop" : "play"} size={SIZE.iconLarge} />
      <span
        style={{
          fontFamily: TYPE.display,
          fontSize: 13,
          letterSpacing: TYPE.displayTracking,
          whiteSpace: "nowrap",
        }}
      >
        {props.playing ? "BUILD" : "PLAY IT"}
      </span>
    </button>
  );
}

/**
 * The actual sprite, on a small canvas.
 *
 * Drawn by the same code the world uses (see src/host/partArt.ts), so the chip
 * cannot drift from the tile. The backing store is scaled by a WHOLE number of
 * device pixels - a fractional ratio on nearest-neighbour art reintroduces the
 * uneven-pixel problem the whole art direction exists to avoid.
 */
function PartSwatch({ partId, size }: { partId: number; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    drawPartArt(ctx, partId, 0, 0, size);
  }, [partId, size]);

  return (
    <canvas
      ref={ref}
      style={{
        width: size,
        height: size,
        imageRendering: "pixelated",
        // The chip wears the same outline the button does, one step in.
        boxShadow: `0 0 0 2px ${UI.ink}`,
      }}
    />
  );
}

/** A piece of the world you can place. */
export function PartButton(props: {
  partId: number;
  /** The full name, shown as the tooltip. */
  label: string;
  /** What the chip itself shows, when the full name does not fit. */
  short?: string;
  selected: boolean;
  onClick: () => void;
}) {
  const style: PixelStyle = {
    ...centred,
    ...toneStyle("neutral", props.selected),
    flexDirection: "column",
    gap: 4,
    width: SIZE.partTile,
    height: SIZE.partTile,
  };

  return (
    <button
      type="button"
      onClick={props.onClick}
      onPointerDown={pressSound("select")}
      title={props.label}
      // The chip may show a short form ("Gem"); a screen reader hears the full name. The visible
      // text is always a word of the full name, so WCAG 2.5.3 (label in name) holds.
      aria-label={props.label}
      aria-pressed={props.selected}
      className="pf-press"
      style={style}
    >
      <PartSwatch partId={props.partId} size={24} />
      <span
        style={{
          ...labelStyle,
          fontSize: 9,
          lineHeight: "10px",
          whiteSpace: "normal",
          maxWidth: SIZE.partTile - 10,
          // Up to two lines, wrapping at the space: "Blue warp" reads as "Blue" over "warp".
          maxHeight: 20,
          textAlign: "center",
          overflow: "hidden",
        }}
      >
        {props.short ?? props.label}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/** A labelled zone, so a dock reads as groups rather than as a wall. */
export function Group(props: {
  label?: string;
  children: ReactNode;
  vertical?: boolean;
  /** Keep the label in view while a horizontally scrolling parent moves the chips under it. */
  pinLabel?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {props.label && (
        <span
          style={{
            ...(props.pinLabel
              ? { position: "sticky", left: 0, alignSelf: "flex-start", zIndex: 1, background: UI.surface, paddingRight: 6 }
              : null),
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: UI.textDim,
            paddingLeft: 1,
          }}
        >
          {props.label}
        </span>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: props.vertical ? "column" : "row",
          alignItems: "center",
          gap: 6,
        }}
      >
        {props.children}
      </div>
    </div>
  );
}

/** A hard 2px rule between groups inside one dock. */
export function Divider({ vertical = true }: { vertical?: boolean }) {
  return (
    <span
      aria-hidden
      className="pf-divider"
      style={{
        background: UI.ink,
        opacity: 0.55,
        width: vertical ? 2 : "100%",
        height: vertical ? "70%" : 2,
        alignSelf: "center",
        flex: "none",
      }}
    />
  );
}
