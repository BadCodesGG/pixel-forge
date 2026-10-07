"use client";

import { useState } from "react";
import { Modal } from "./Panel";
import { ActionButton, Divider, ToolButton } from "./Controls";
import { Icon } from "./Icon";
import { BRAND } from "@/branding";
import { SIZE, TYPE, UI, toneStyle, well, type PixelStyle } from "@/design/tokens";
import { MOVES, type Move, type Scheme } from "../controls";
import type { TouchOverride } from "../TouchPad";

/**
 * HOW TO PLAY.
 *
 * Built on Modal, which brings Escape, the focus trap, the scrim and the
 * role="dialog" that makes the Editor's global key handler stand down. That
 * last one matters more than it looks: without it, reading the guide would
 * switch tools behind the panel.
 *
 * ---------------------------------------------------------------------------
 * WHY THREE TABS AND NOT ALL THREE AT ONCE
 * ---------------------------------------------------------------------------
 * Auto-detecting a single scheme is what produced the bug this feature exists
 * to answer: the old one-line hint assumed a keyboard and told tablet players
 * to press SPACE. Detection picks the tab that opens, and nothing more - a
 * young player on a tablet with a keyboard folio is one tap from the other column.
 *
 * Stacking all three instead would triple the height, and a landscape phone is
 * about 390px tall. The tabs are the reason this fits at all.
 *
 * THE BODY OWNS ITS OWN SCROLL. Modal caps the panel at 100% height but has no
 * scroll container of its own, so a seven-row guide would simply be cut off on
 * a short viewport. Same fix as LevelShelf, and for the same reason.
 */

interface Tab {
  scheme: Scheme;
  label: string;
  icon: "hand" | "keyboard" | "gamepad";
}

const TABS: Tab[] = [
  { scheme: "touch", label: "Touch", icon: "hand" },
  { scheme: "keys", label: "Keys", icon: "keyboard" },
  { scheme: "pad", label: "Pad", icon: "gamepad" },
];

/** What this move looks like on the chosen scheme. */
function howTo(move: Move, scheme: Scheme): string {
  if (scheme === "touch") return move.touch;
  if (scheme === "pad") return move.pad;
  return move.keys.join("  or  ");
}

function MoveCard({ move, scheme }: { move: Move; scheme: Scheme }) {
  const style: PixelStyle = {
    ...toneStyle("neutral"),
    boxShadow: "var(--pf-shadow)",
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: 10,
    fontFamily: TYPE.ui,
    textAlign: "left",
  };

  return (
    <div style={style}>
      <span style={{ flex: "none", marginTop: 1 }}>
        <Icon name={move.icon} size={SIZE.iconLarge} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span
          style={{
            fontFamily: TYPE.display,
            fontSize: 10,
            letterSpacing: TYPE.displayTracking,
            color: UI.gold,
          }}
        >
          {move.label}
        </span>
        <span style={{ fontSize: TYPE.label, fontWeight: TYPE.labelWeight }}>
          {howTo(move, scheme)}
        </span>
        {move.note && (
          <span style={{ fontSize: TYPE.tiny, color: UI.textDim, fontWeight: 600 }}>
            {move.note}
          </span>
        )}
      </span>
    </div>
  );
}

export function ControlsGuide(props: {
  /** Which tab opens first, from what the player is actually holding. */
  scheme: Scheme;
  /** Short viewport: let the panel use the full width. */
  compact: boolean;
  /** Whether the on-screen pad is currently up, however that was decided. */
  touchActive: boolean;
  /** null means the player has not overridden detection. */
  override: TouchOverride;
  onSetOverride: (value: TouchOverride) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Scheme>(props.scheme);

  /**
   * Two buttons rather than a tri-state.
   *
   * Pressing the one that is already latched clears back to automatic, so all
   * three states are reachable without a young player ever having to discover that
   * "auto" is a thing. Auto is simply the default nobody has to think about.
   */
  const pick = (value: Exclude<TouchOverride, null>) =>
    props.onSetOverride(props.override === value ? null : value);

  return (
    <Modal title="HOW TO PLAY" onClose={props.onClose} width={props.compact ? "100%" : 560}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <ToolButton
            key={t.scheme}
            icon={t.icon}
            label={t.label}
            selected={tab === t.scheme}
            onClick={() => setTab(t.scheme)}
          />
        ))}
      </div>

      <div
        style={{
          ...well(),
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
          gap: 10,
          padding: 12,
          // min() so a tall phone gets a generous panel and a short landscape
          // one still leaves the tabs and the footer on screen.
          maxHeight: "min(52vh, 400px)",
          overflowY: "auto",
        }}
      >
        {MOVES.map((move) => (
          <MoveCard key={move.label} move={move} scheme={tab} />
        ))}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span
          style={{
            fontSize: TYPE.tiny,
            fontWeight: TYPE.tinyWeight,
            color: UI.textDim,
            letterSpacing: "0.04em",
          }}
        >
          BUTTONS ON SCREEN
        </span>
        <ActionButton
          icon="tick"
          label="On"
          tone={props.override === "on" ? "go" : "neutral"}
          onClick={() => pick("on")}
          title="Always show the d-pad and the jump button"
        />
        <ActionButton
          icon="close"
          label="Off"
          tone={props.override === "off" ? "danger" : "neutral"}
          onClick={() => pick("off")}
          title="Never show them - play with a keyboard or a pad"
        />
        <span style={{ fontSize: TYPE.tiny, color: UI.textDim, minWidth: 0 }}>
          {props.override === null
            ? `Now: automatic (${props.touchActive ? "on" : "off"})`
            : "Now: your choice"}
        </span>
        <Divider />
        <a
          className="pf-focus"
          href={BRAND.credit.href}
          // A new tab: leaving in this one would drop up to 8s of level edits the autosave has not written.
          target="_blank"
          rel={`${BRAND.credit.rel} noopener`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 24,
            fontSize: TYPE.tiny,
            fontWeight: TYPE.tinyWeight,
            color: UI.textDim,
            textDecoration: "underline",
          }}
        >
          {BRAND.credit.text}
        </a>
        <span style={{ marginLeft: "auto" }}>
          <ActionButton icon="tick" label="Got it" tone="go" wide onClick={props.onClose} />
        </span>
      </div>
    </Modal>
  );
}
