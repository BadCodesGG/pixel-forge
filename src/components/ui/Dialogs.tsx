"use client";

import { useEffect, useRef, useState } from "react";
import { Modal, Panel } from "./Panel";
import { ActionButton, Divider } from "./Controls";
import { Icon } from "./Icon";
import { SIZE, TYPE, UI, toneStyle, well, type PixelStyle } from "@/design/tokens";
import { audio } from "@/host/audio";

/**
 * THE THREE PANELS THAT REPLACE THE BROWSER.
 *
 * A native <select>, window.prompt and window.confirm were the three loudest
 * "this is a web page" signals in the app. Nothing about them is wrong as
 * engineering; they simply announce, every time they open, that this is a
 * document and not a game.
 */

export interface LevelEntry {
  id: string;
  title: string;
  updatedAt: number;
}

/**
 * Deterministic sticker colour per level.
 *
 * Six saturated hues off a cheap hash of the id, so every cartridge is visually
 * distinct at a glance with no extra data stored. Real minimap thumbnails would
 * be better, but the library only carries {id, title, updatedAt} - a later
 * step, not this one.
 */
const STICKERS = [UI.go, UI.gold, UI.pick, UI.danger, "#c084fc", "#5eead4"] as const;

function stickerFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return STICKERS[h % STICKERS.length];
}

/**
 * The only thing worth saying about a level's age.
 *
 * There is deliberately no "3h ago" here. It would mean reading the clock
 * during render, which is impure - the same props would produce different
 * output on a re-render - and more to the point a young player does not use
 * a relative timestamp to find a level. They use the name and the colour.
 *
 * updatedAt 0 means "never written to disk", which IS worth saying, and needs
 * no clock at all.
 */
function savedNote(updatedAt: number): string {
  return updatedAt === 0 ? "not saved yet" : "";
}

/**
 * The level library, as a shelf of cartridges.
 *
 * Replaces the native <select>, and along the way fixes a live bug it had: the
 * dropdown's value was the CURRENT document id, but its options came from the
 * repository, so straight after New or Test room it pointed at a level that had
 * not been saved yet and the browser fell back to displaying the first option.
 * For up to eight seconds the control claimed you were editing a different
 * level. A shelf that is handed the current document cannot do that.
 */
export function LevelShelf(props: {
  library: LevelEntry[];
  currentId: string;
  currentTitle: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onGreybox: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  // The open document always appears, even before its first autosave - which is
  // precisely the case the old <select> got wrong.
  const entries: LevelEntry[] = props.library.some((l) => l.id === props.currentId)
    ? props.library
    : [{ id: props.currentId, title: props.currentTitle, updatedAt: 0 }, ...props.library];

  return (
    <Modal title="MY LEVELS" onClose={props.onClose} width={560}>
      <div
        style={{
          ...well(),
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 10,
          padding: 12,
          maxHeight: "46vh",
          overflowY: "auto",
        }}
      >
        {entries.map((entry) => {
          const on = entry.id === props.currentId;
          const style: PixelStyle = {
            ...toneStyle("neutral", on),
            display: "flex",
            flexDirection: "column",
            alignItems: "stretch",
            gap: 6,
            padding: 8,
            fontFamily: TYPE.ui,
            textAlign: "left",
          };
          return (
            <button
              key={entry.id}
              type="button"
              className="pf-press"
              style={style}
              data-sunk={on ? "true" : undefined}
              aria-pressed={on}
              onPointerDown={() => {
                audio.unlock();
                audio.select();
              }}
              onClick={() => props.onOpen(entry.id)}
            >
              <span
                aria-hidden
                style={{
                  height: 20,
                  background: stickerFor(entry.id),
                  boxShadow: `inset 0 3px 0 0 rgba(255,255,255,0.35), 0 0 0 2px ${UI.ink}`,
                }}
              />
              <span
                style={{
                  fontSize: TYPE.label,
                  fontWeight: TYPE.labelWeight,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {entry.title}
              </span>
              <span style={{ fontSize: 10, opacity: 0.7, minHeight: 12 }}>
                {savedNote(entry.updatedAt)}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <ActionButton icon="folder" label="New" tone="go" onClick={props.onNew} />
        <ActionButton icon="sparkle" label="Test room" onClick={props.onGreybox} />
        <Divider />
        <ActionButton icon="download" label="Back up" onClick={props.onExport} />
        <ActionButton
          icon="upload"
          label="Restore"
          onClick={() => fileRef.current?.click()}
          title="Load levels back from a file"
        />
        <span style={{ marginLeft: "auto" }}>
          <ActionButton icon="trash" label="Delete" tone="danger" onClick={props.onDelete} />
        </span>
        {/* Kept in the tree but out of the tab order - the ActionButton above is
            the real control, so there is one button recipe rather than a
            hand-styled <label> duplicating it. */}
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          tabIndex={-1}
          aria-hidden
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) props.onImport(file);
            e.target.value = "";
          }}
        />
      </div>
    </Modal>
  );
}

/**
 * Naming a level.
 *
 * Replaces window.prompt. The field is an INVERTED bevel - light on the
 * bottom-right, dark on the top-left - so it reads as a well rather than a
 * button. Same vocabulary, opposite direction.
 */
export function NamePanel(props: {
  initial: string;
  onSubmit: (title: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(props.initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // Select the whole thing so typing replaces rather than appends: renaming
    // is usually a replacement.
    el.select();
  }, []);

  const submit = () => {
    const next = value.trim().slice(0, 40);
    if (next) props.onSubmit(next);
    else props.onClose();
  };

  return (
    <Modal title="NAME THIS LEVEL" onClose={props.onClose}>
      <input
        ref={inputRef}
        value={value}
        maxLength={40}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Stop these reaching the Editor's global handler. It bails on text
          // fields anyway; this is the second lock on the same door.
          e.stopPropagation();
          if (e.key === "Enter") submit();
        }}
        style={{
          ...well(),
          width: "100%",
          padding: "12px 12px",
          fontFamily: TYPE.ui,
          fontSize: 20,
          fontWeight: TYPE.labelWeight,
          color: UI.text,
          caretColor: UI.gold,
          outline: "none",
        }}
      />
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <ActionButton icon="close" label="Cancel" onClick={props.onClose} />
        <ActionButton icon="tick" label="Done" tone="go" wide onClick={submit} />
      </div>
    </Modal>
  );
}

/**
 * Confirming something destructive.
 *
 * Replaces window.confirm. The scrim does not dismiss, and the SAFE option
 * takes initial focus - defaulting to the harmless choice is the entire point
 * of a confirmation.
 */
export function ConfirmPanel(props: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={props.title} onClose={props.onClose} dismissOnScrim={false}>
      <p
        style={{
          margin: 0,
          fontSize: TYPE.body,
          fontWeight: TYPE.bodyWeight,
          lineHeight: 1.5,
          color: UI.textSoft,
        }}
      >
        {props.message}
      </p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <span data-autofocus>
          <ActionButton icon="tick" label="Keep it" tone="go" wide onClick={props.onClose} />
        </span>
        <ActionButton
          icon="trash"
          label={props.confirmLabel}
          tone="danger"
          onClick={props.onConfirm}
        />
      </div>
    </Modal>
  );
}

/**
 * A transient message, floating under the top dock.
 *
 * Replaces the row of small text under the game. A status bar is a document
 * idiom; a message that appears over the world, says one thing and goes away is
 * a game idiom.
 */
export function Toast(props: { text: string; tone: "info" | "good" | "warn" }) {
  const face =
    props.tone === "good" ? "go" : props.tone === "warn" ? "warn" : ("neutral" as const);
  return (
    <Panel
      className="pf-pop"
      style={{
        ...toneStyle(face as "go" | "warn" | "neutral"),
        boxShadow: "var(--pf-shadow)",
        gap: 8,
        padding: "8px 14px",
      }}
    >
      <Icon
        name={props.tone === "good" ? "tick" : props.tone === "warn" ? "sparkle" : "save"}
        size={SIZE.iconSmall}
      />
      <span style={{ fontSize: TYPE.label, fontWeight: TYPE.labelWeight, whiteSpace: "nowrap" }}>
        {props.text}
      </span>
    </Panel>
  );
}
