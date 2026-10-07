"use client";

import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { SIZE, TYPE, UI, bevel, textOutline, type PixelStyle } from "@/design/tokens";

/**
 * PANELS AND MENUS.
 *
 * A dock and a dialog are built from the same box, deliberately: in a game, a
 * menu and a toolbar are visibly the same object made of the same material. In
 * a web app they are a toolbar and a modal, which is half of why the previous
 * design read as a CMS.
 *
 * WHY NOT <dialog> / showModal(). Its user-agent backdrop and default styling
 * are exactly the browser chrome the brief rejects, and its top-layer stacking
 * fights a fixed full-bleed canvas. Hand-rolling costs about thirty lines and
 * keeps the look under our control.
 */

/** A bevelled box. The material everything in the interface is cut from. */
export function Panel(props: {
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
  /** Panels that float over the world need pointer events back on. */
  interactive?: boolean;
}) {
  const style: PixelStyle = {
    ...bevel({
      face: UI.surface,
      fg: UI.text,
      hi: UI.surfaceLight,
      lo: UI.surfaceDark,
      shadow: SIZE.shadow + 1,
    }),
    boxShadow: "var(--pf-shadow)",
    display: "flex",
    alignItems: "center",
    pointerEvents: props.interactive === false ? "none" : "auto",
    ...props.style,
  };

  return (
    <div className={props.className} style={style}>
      {props.children}
    </div>
  );
}

/** A panel heading, in the arcade face. */
export function PanelTitle(props: { children: ReactNode; tone?: string }) {
  return (
    <h2
      style={{
        margin: 0,
        fontFamily: TYPE.display,
        fontSize: 13,
        letterSpacing: TYPE.displayTracking,
        color: props.tone ?? UI.gold,
        textShadow: textOutline(2),
      }}
    >
      {props.children}
    </h2>
  );
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A modal panel over a scrim.
 *
 * Owns three things the rest of the app must therefore NOT do:
 *
 *   - Escape. The Editor's global key handler bails entirely while a dialog is
 *     open, so there is exactly one owner and no double-handling.
 *   - Focus. Saved on mount, restored on unmount, and trapped in between -
 *     without the trap, Tab walks straight out onto the canvas and the dialog
 *     is lost behind the game.
 *   - Whether a click on the scrim dismisses. False for anything destructive:
 *     a delete needs a deliberate choice, not a stray click.
 */
export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  dismissOnScrim?: boolean;
  width?: number | string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const { onClose } = props;

  useEffect(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // Prefer whatever the dialog marked as the safe default (see ConfirmPanel),
    // then the first focusable thing, then the panel itself.
    const preferred = panel?.querySelector<HTMLElement>("[data-autofocus]");
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (preferred ?? first ?? panel)?.focus();

    return () => {
      const back = returnTo.current;
      // Guard: the element may have been unmounted along with the dialog.
      if (back && document.contains(back)) back.focus();
    };
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  return (
    <div
      className="pf-fade"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(6,8,18,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 50,
      }}
      onPointerDown={(e) => {
        if (props.dismissOnScrim === false) return;
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="pf-pop"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{
          ...bevel({
            face: UI.surface,
            fg: UI.text,
            hi: UI.surfaceLight,
            lo: UI.surfaceDark,
            shadow: SIZE.shadow + 2,
          }),
          boxShadow: "var(--pf-shadow)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          padding: 18,
          width: props.width ?? 420,
          maxWidth: "100%",
          maxHeight: "100%",
          outline: "none",
        }}
      >
        <PanelTitle>{props.title}</PanelTitle>
        {props.children}
      </div>
    </div>
  );
}
