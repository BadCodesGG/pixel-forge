"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { EditorSession, type Tool } from "@/editor/session";
import { EditorRenderer } from "@/host/editorRenderer";
import { GameLoop } from "@/host/loop";
import { buildGreyboxDoc } from "@/engine/greybox";
import { createEmptyLevel, MARKER_GOAL, MARKER_START, type LevelDoc } from "@/format/level";
import { objectParts, partById, tileParts } from "@/format/parts";
import { TILE_PX } from "@/engine/math/fixed";
import { type IconName } from "./ui/Icon";
import {
  ActionButton,
  Divider,
  Group,
  IconButton,
  PartButton,
  PlayButton,
  ToolButton,
} from "./ui/Controls";
import { Panel } from "./ui/Panel";
import { ConfirmPanel, LevelShelf, NamePanel, Toast } from "./ui/Dialogs";
import { ControlsGuide } from "./ui/ControlsGuide";
import { LAYOUT, SIZE, TYPE, UI, textOutline, toneStyle } from "@/design/tokens";
import { levelRepository, requestPersistentStorage } from "@/persistence/idb";
import { getLocalGuestId } from "@/persistence/repository";
import { downloadBundle, makeBundle, parseBundle } from "@/persistence/transfer";
import { audio } from "@/host/audio";
import { TouchPad, useTouchControls } from "./TouchPad";
import { hintFor, schemeFor, type Scheme } from "./controls";
import type { InputSource } from "@/host/input";

/**
 * THE EDITOR.
 *
 * ===========================================================================
 * THE LAYOUT IS THREE LAYERS, AND THE ORDER MATTERS
 * ===========================================================================
 *   1. THE WORLD   - absolutely positioned, fills the viewport, holds both
 *                    canvases. It NEVER changes size when the mode changes;
 *                    switching between build and play only swaps which canvas
 *                    is displayed. That is what protects the ResizeObserver
 *                    from firing on a mode change, and it lets the play view's
 *                    whole-number scale be computed once against the real
 *                    viewport.
 *   2. THE CHROME  - docks floating over the world. The container has
 *                    pointerEvents: "none" so the GAPS between docks are still
 *                    clickable as canvas; each dock turns them back on for
 *                    itself.
 *   3. THE MODALS  - the level shelf, renaming, and confirmations.
 *
 * The docks are cornered panels, not full-width bars. A full-width bar is a web
 * toolbar, and that is half of what made the previous design read as a CMS
 * rather than a game.
 *
 * Labels are written for a young reader -- "Ground", "Platform", "Start",
 * "Finish" -- rather than in the vocabulary of the data model. A young player who
 * cannot parse "clear condition" or "visibility: unlisted" is not going to ask
 * for a glossary; they are going to stop using the editor.
 */

/**
 * The part belt's height: one row on a short landscape phone (the max-height 500px block in
 * globals.css), two rows everywhere else. The canvas fit (on load and on See it all) and the
 * renderer's insets use it, so the level view grows into the room a one-row belt frees. A rotation
 * moves the insets at once; the camera stays where the player left it until they fit again.
 */
const beltHeight = () => (window.matchMedia("(max-height: 500px)").matches ? LAYOUT.shortBelt : LAYOUT.bottomBelt);

/**
 * Tool vocabulary.
 *
 * Words a young player already owns, never interface jargon: "Rub out" rather than
 * "Eraser tool", "Fill" rather than "Rectangle fill". The hint is what appears
 * on hover and reads as an instruction, not a description.
 */
const TOOL_META: Record<Tool, { label: string; icon: IconName; hint: string; key: string }> = {
  pencil: { label: "DRAW", icon: "pencil", hint: "Drag to draw blocks", key: "1" },
  eraser: { label: "RUB OUT", icon: "eraser", hint: "Drag to take blocks away", key: "2" },
  rect: { label: "FILL", icon: "rect", hint: "Drag a big box and fill it in", key: "3" },
  start: { label: "START", icon: "start", hint: "Where you start the level", key: "4" },
  goal: { label: "FINISH", icon: "finish", hint: "Where you win the level", key: "5" },
};

type Status = { text: string; tone: "info" | "good" | "warn" } | null;

/**
 * One state for every dialog, rather than three booleans.
 *
 * A discriminated union means there is exactly one render site, exactly one
 * Escape path, and no way to open two panels at once.
 */
type Dialog =
  | { kind: "levels" }
  | { kind: "rename" }
  | { kind: "confirmDelete"; title: string }
  | { kind: "controls" }
  | null;

export default function Editor() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const editCanvasRef = useRef<HTMLCanvasElement>(null);
  const playCanvasRef = useRef<HTMLDivElement>(null);
  const playCanvasElRef = useRef<HTMLCanvasElement>(null);

  const sessionRef = useRef<EditorSession | null>(null);
  const rendererRef = useRef<EditorRenderer | null>(null);
  const loopRef = useRef<GameLoop | null>(null);

  /**
   * View toggles read by the render loop.
   *
   * Mirrored into a ref because the frame callback runs 60x a second and must
   * see the current value immediately, not whatever was captured when React
   * last rendered.
   */
  const viewRef = useRef({ showGrid: true, showMinimap: true });

  const cursorRef = useRef<{ tx: number | null; ty: number | null }>({ tx: null, ty: null });
  const rectRef = useRef<{ tx0: number; ty0: number; tx1: number; ty1: number } | null>(null);
  const dragRef = useRef<"none" | "paint" | "rect" | "pan" | "minimap">("none");
  const panRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const [ui, setUi] = useState({
    tool: "pencil" as Tool,
    part: 1,
    mode: "edit" as "edit" | "play",
    dirty: false,
    canUndo: false,
    canRedo: false,
    title: "My level",
    issues: [] as { severity: string; message: string }[],
    showGrid: true,
    showMinimap: true,
    zoom: 1,
    coins: 0,
    score: 0,
    deaths: 0,
    cleared: false,
    powerTier: 0,
    timeLeft: 0,
  });
  const [status, setStatus] = useState<Status>(null);
  const [library, setLibrary] = useState<{ id: string; title: string; updatedAt: number }[]>([]);
  const [currentId, setCurrentId] = useState<string>("");
  const [muted, setMuted] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [fullscreen, setFullscreen] = useState(false);

  /**
   * Whether to show on-screen controls.
   *
   * ONE fact with ONE owner, because two things depend on it and they must not
   * be able to disagree: the overlay draws the d-pad, and PlayControls moves
   * out of the bottom-right corner so the jump button is reachable. When the
   * play dock stayed put, it covered 66 of the jump button's 76 pixels and
   * every jump attempt pressed "Build" instead.
   *
   * It is a live hook, not a value read once at mount - see useTouchControls.
   */
  const touch = useTouchControls();

  /**
   * The input source, in state rather than read from the loop ref.
   *
   * Refs must not be read during render -- the value is not tracked, so React
   * cannot know to re-render when it appears, and the touch overlay would stay
   * wired to null forever.
   */
  const [inputSource, setInputSource] = useState<InputSource | null>(null);

  const refreshLibrary = useCallback(async () => {
    try {
      const all = await levelRepository.list();
      setLibrary(all.map((r) => ({ id: r.id, title: r.doc.title, updatedAt: r.updatedAt })));
    } catch {
      // A blocked IndexedDB must not break the editor; it just means no library.
    }
  }, []);

  const syncUi = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    setUi((prev) => ({
      ...prev,
      tool: s.tool,
      part: s.activePart,
      mode: s.mode,
      dirty: s.dirty,
      canUndo: s.history.canUndo,
      canRedo: s.history.canRedo,
      title: s.doc.title,
      issues: s.issues,
      zoom: s.camera.zoom,
      coins: s.sim.coins,
      score: s.sim.score,
      deaths: s.sim.deaths,
      cleared: s.sim.cleared,
      powerTier: s.sim.player.powerTier,
      timeLeft: s.sim.timeLeft,
    }));
  }, []);

  /**
   * Fit the whole level into the part of the screen that is not under a dock.
   *
   * `zoomToFit` centres the level within the box it is handed, so handing it
   * the SAFE box is the whole correction - the level lands in the middle of the
   * space the chrome is not covering.
   *
   * DO NOT follow this with `panBy` to shift it right by the left inset. That
   * looks correct and is not: `panBy` calls the session's camera clamp with a
   * zero-sized viewport, which pins camera.x to >= 0 - and a camera at x = 0
   * puts the level's LEFT EDGE at screen zero. The level ends up jammed into
   * the top-left corner, which is exactly the bug this comment exists to stop
   * someone reintroducing.
   */
  const fitToSafeArea = useCallback(() => {
    const wrap = wrapRef.current;
    const s = sessionRef.current;
    if (!wrap || !s) return;
    const w = wrap.clientWidth - (LAYOUT.leftRail + LAYOUT.edge * 3);
    const h = wrap.clientHeight - (LAYOUT.topDock + beltHeight() + LAYOUT.edge * 4);
    s.zoomToFit(Math.max(160, w), Math.max(120, h));
  }, []);

  /**
   * Open on the start flag at working zoom, rather than zoomed out to the whole
   * level.
   *
   * A 120-tile level fitted to the screen is drawn at quarter or half scale,
   * which is a map rather than a workspace - you cannot see what a block is,
   * let alone place one. Every level editor of this kind opens where the player
   * will start, at a size you can build at. "See it all" stays one press away.
   */
  const centerOnStart = useCallback(() => {
    const wrap = wrapRef.current;
    const s = sessionRef.current;
    if (!wrap || !s) return;
    let tx = 3;
    let ty = Math.floor(s.doc.height / 2);
    for (const obj of s.doc.allObjects()) {
      if (obj.part === MARKER_START) {
        tx = obj.tx;
        ty = obj.ty;
        break;
      }
    }

    // `centerOn` puts a tile at the middle of the VIEWPORT, but the middle of
    // the viewport is not the middle of the space you can actually see - the
    // docks cover a left rail, a top bar and a bottom belt. So aim at the
    // middle of the SAFE area instead.
    //
    // Derivation, so the signs are not guesswork: centerOn(tx') sets
    //   camera.x = tx' * TILE - W / zoom / 2
    // which puts world tile tx at screen x = (tx - tx') * TILE * zoom + W / 2.
    // Wanting that to equal W / 2 + dx gives tx' = tx - dx / (TILE * zoom).
    // Put the start flag just clear of the tool rail, not in the middle.
    //
    // The flag sits three tiles from the left edge of the WORLD, so centring it
    // fills a quarter of the screen with the void outside the level - and you
    // build rightwards from it anyway, so the space that matters is the space
    // to its right. This trades dead space for level.
    const zoom = s.camera.zoom;
    const safeLeft = LAYOUT.leftRail + LAYOUT.edge * 2;
    const dx = safeLeft + 40 - wrap.clientWidth / 2;
    const dy = (LAYOUT.topDock - beltHeight()) / 2;

    s.centerOn(
      tx - dx / (TILE_PX * zoom),
      ty - dy / (TILE_PX * zoom),
      wrap.clientWidth,
      wrap.clientHeight,
    );
  }, []);

  /**
   * While playing, poll the sim for the HUD.
   *
   * 8 Hz, and only in play mode. Pushing coin/score changes through React as
   * they happen would mean re-rendering during the frame loop, which is the
   * one thing this component exists to prevent.
   */
  useEffect(() => {
    if (ui.mode !== "play") return;
    const timer = window.setInterval(syncUi, 125);
    return () => window.clearInterval(timer);
  }, [ui.mode, syncUi]);

  /**
   * A dialog over a running game freezes it.
   *
   * The controls guide is the first panel that can be opened DURING play - the
   * other three are only reachable from build mode, where the loop is already
   * stopped. Without this, asking how to jump gets you killed while you read
   * the answer, which is a fairly complete inversion of the point.
   *
   * Written as one effect over `dialog` rather than wired into the guide, so
   * any future play-mode panel inherits the behaviour instead of having to
   * remember it.
   */
  useEffect(() => {
    loopRef.current?.setPaused(ui.mode === "play" && dialog !== null);
  }, [dialog, ui.mode]);

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const editCanvas = editCanvasRef.current;
    const playCanvas = playCanvasElRef.current;
    const wrap = wrapRef.current;
    if (!editCanvas || !playCanvas || !wrap) return;

    /**
     * Every resource is declared HERE, in the effect body, so the returned
     * cleanup closes over whatever exists at teardown.
     *
     * This used to stash the cleanup on `window.__pfCleanup` AFTER an await,
     * which had two failure modes: if teardown ran before the async body
     * reached that line, the rAF loop and the ResizeObserver leaked; and
     * because the slot was a module global, React 19's development
     * double-invoke overwrote the first invocation's cleanup, so its rAF was
     * never cancelled and two loops ran for the life of the page.
     */
    let cancelled = false;
    let raf = 0;
    let observer: ResizeObserver | null = null;
    let loop: GameLoop | null = null;

    (async () => {
      // Reopen the most recent level, or start a fresh one. Coming back to what
      // you were building is the difference between a tool and a toy.
      let doc = createEmptyLevel(crypto.randomUUID());
      try {
        const saved = await levelRepository.list();
        if (saved.length > 0) doc = saved[0].doc;
      } catch {
        // A blocked or unavailable IndexedDB must not stop the editor opening.
      }
      // Nothing is CONSTRUCTED after teardown, so there is nothing to leak.
      if (cancelled) return;

      const session = new EditorSession(doc);
      sessionRef.current = session;
      setCurrentId(doc.id);
      void refreshLibrary();

      const renderer = new EditorRenderer(editCanvas);
      rendererRef.current = renderer;
      // Keep the minimap and the level frame clear of the floating docks.
      renderer.insets = {
        top: LAYOUT.topDock + LAYOUT.edge * 2,
        right: LAYOUT.edge,
        bottom: beltHeight() + LAYOUT.edge * 2,
        left: LAYOUT.leftRail + LAYOUT.edge * 2,
      };

      loop = new GameLoop(playCanvas);
      loop.attachSim(session.sim);
      loopRef.current = loop;
      setInputSource(loop.input);

      if (process.env.NODE_ENV !== "production") {
        // A GETTER, not a snapshot: opening a different level replaces the
        // session, and a captured reference would silently keep reporting on
        // the level you are no longer editing.
        (window as unknown as { __pf?: unknown }).__pf = {
          get session() {
            return sessionRef.current;
          },
          loop,
          renderer,
        };
      }

      const activeLoop = loop;
      const resize = () => {
        const rect = wrap.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        // Turning a phone changes the belt between one row and two, so the inset follows it.
        renderer.insets.bottom = beltHeight() + LAYOUT.edge * 2;
        renderer.resize(rect.width, rect.height, dpr);
        activeLoop.resize(wrap, dpr);
      };
      resize();
      centerOnStart();

      observer = new ResizeObserver(resize);
      observer.observe(wrap);

      const frame = () => {
        raf = requestAnimationFrame(frame);
        // Read the CURRENT session each frame rather than closing over the one
        // that existed at boot, so opening a different level is a reassignment
        // rather than a teardown.
        const active = sessionRef.current;
        if (!active || active.mode !== "edit") return;
        renderer.draw(active.doc, active.camera, {
          cursorTx: cursorRef.current.tx,
          cursorTy: cursorRef.current.ty,
          rect: rectRef.current,
          activePart: active.tool === "eraser" ? 0 : active.activePart,
          // Read from refs, not React state: this runs every frame and must
          // not depend on a re-render having happened.
          showGrid: viewRef.current.showGrid,
          showMinimap: viewRef.current.showMinimap,
        });
      };
      raf = requestAnimationFrame(frame);

      syncUi();
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf); // 0 is a safe no-op
      observer?.disconnect();
      loop?.stop();
    };
  }, [syncUi, refreshLibrary, centerOnStart]);

  // ---------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------
  const save = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      await levelRepository.save(s.doc.toDoc(), getLocalGuestId());
      await requestPersistentStorage();
      s.markSaved();
      setStatus({ text: "Saved", tone: "good" });
      await refreshLibrary();
      syncUi();
    } catch {
      // Never silently swallow a failed save -- losing work is the one bug that
      // would end this project.
      setStatus({ text: "Could not save. Try backing up instead.", tone: "warn" });
    }
  }, [syncUi, refreshLibrary]);

  /**
   * Swap the open level.
   *
   * Saves any pending work FIRST. Switching levels is exactly the moment a
   * young player would lose an afternoon's building, and "it autosaves in a few
   * seconds" is not a promise that survives a click.
   */
  const openDoc = useCallback(
    async (doc: LevelDoc) => {
      const previous = sessionRef.current;
      if (previous?.dirty) {
        try {
          await levelRepository.save(previous.doc.toDoc(), getLocalGuestId());
        } catch {
          setStatus({ text: "Couldn't save the last level.", tone: "warn" });
        }
      }
      const next = new EditorSession(doc);
      sessionRef.current = next;
      loopRef.current?.attachSim(next.sim);
      setCurrentId(doc.id);
      centerOnStart();
      await refreshLibrary();
      syncUi();
    },
    [refreshLibrary, syncUi, centerOnStart],
  );

  // Autosave a few seconds after the last edit, and on the way out.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (sessionRef.current?.dirty) void save();
    }, 8000);
    const onHide = () => {
      if (sessionRef.current?.dirty) void save();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onHide);
    };
  }, [save]);

  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => setStatus(null), 2200);
    return () => window.clearTimeout(t);
  }, [status]);

  /**
   * Fullscreen.
   *
   * A console game does not run in a window with a browser around it, and the
   * play view is scaled by a WHOLE number - so the extra height fullscreen buys
   * is not just cosmetic, it is often the difference between 3x and 4x. The
   * state is driven by the fullscreenchange EVENT rather than by the click,
   * because the user can leave with Escape or F11 and the button has to know.
   */
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  // ---------------------------------------------------------------------------
  // Mode switching
  // ---------------------------------------------------------------------------
  const startPlay = useCallback(
    (fromCursor: boolean) => {
      const s = sessionRef.current;
      const loop = loopRef.current;
      if (!s || !loop) return;
      const from =
        fromCursor && cursorRef.current.tx !== null && cursorRef.current.ty !== null
          ? { tx: cursorRef.current.tx, ty: cursorRef.current.ty }
          : undefined;
      // Unlock audio here as well as in the control vocabulary: pressing Enter
      // never touches a button, and a gesture is the only moment a browser will
      // let an AudioContext start.
      audio.unlock();
      audio.startMusic();

      s.play(from);
      loop.attachSim(s.sim);
      // Size against the OUTER wrapper, not the play container.
      //
      // The play container is `display: none` until React re-renders with the
      // new mode, so measuring it here reports zero and the renderer picks a
      // scale of 1 -- a 384x216 postage stamp in the middle of the screen. The
      // wrapper is the same box and is always laid out.
      loop.start(wrapRef.current ?? undefined);
      syncUi();
    },
    [syncUi],
  );

  const stopPlay = useCallback(() => {
    const s = sessionRef.current;
    s?.stopPlaying();
    loopRef.current?.stop();
    audio.stopMusic();
    syncUi();
  }, [syncUi]);

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = sessionRef.current;
      if (!s) return;

      // ---- GUARDS. Both are load-bearing. ----------------------------------
      //
      // 1. A dialog owns the keyboard while it is open, and Modal owns Escape,
      //    so there is exactly one handler and no double-dismissal.
      //
      //    Asked of the DOM rather than mirrored into a ref: the rendered
      //    dialog IS the state, so there is nothing to keep in sync and no
      //    window in which the mirror is stale. It also means this listener
      //    never re-subscribes when a panel opens, which it would have to if
      //    `dialog` were a dependency - potentially mid-drag.
      if (document.querySelector('[role="dialog"]')) return;
      //
      // 2. Text fields. Without this, typing a level name would switch tools
      //    behind the panel and Enter would launch play mode. This never bit
      //    before only because window.prompt was a native modal that stole
      //    keystrokes from the page - replacing it with a real <input> is
      //    exactly what makes the guard necessary.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }

      // BEFORE the Enter branch, and therefore before play mode returns early
      // below - help has to be reachable from inside a run, which is the only
      // place anyone is stuck. F1 would otherwise open the browser's own help.
      if (e.key === "?" || e.key === "F1" || (e.key === "h" && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        setDialog({ kind: "controls" });
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (s.mode === "edit") startPlay(e.shiftKey);
        else stopPlay();
        return;
      }
      if (s.mode === "play") {
        if (e.key === "r" || e.key === "R") s.restart();
        if (e.key === "Escape") stopPlay();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        syncUi();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
        syncUi();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
        return;
      }

      const toolByKey: Record<string, Tool> = {
        "1": "pencil",
        "2": "eraser",
        "3": "rect",
        "4": "start",
        "5": "goal",
      };
      if (toolByKey[e.key]) {
        s.tool = toolByKey[e.key];
        audio.select();
        syncUi();
        return;
      }
      const wrap = wrapRef.current;
      switch (e.key.toLowerCase()) {
        case "f":
          fitToSafeArea();
          break;
        case "g":
          viewRef.current.showGrid = !viewRef.current.showGrid;
          setUi((p) => ({ ...p, showGrid: viewRef.current.showGrid }));
          break;
        case "m":
          viewRef.current.showMinimap = !viewRef.current.showMinimap;
          setUi((p) => ({ ...p, showMinimap: viewRef.current.showMinimap }));
          break;
        case "=":
        case "+":
          if (wrap) {
            s.zoomBy(1, wrap.clientWidth / 2, wrap.clientHeight / 2, wrap.clientWidth, wrap.clientHeight);
          }
          syncUi();
          break;
        case "-":
          if (wrap) {
            s.zoomBy(-1, wrap.clientWidth / 2, wrap.clientHeight / 2, wrap.clientWidth, wrap.clientHeight);
          }
          syncUi();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startPlay, stopPlay, save, syncUi, fitToSafeArea]);

  // ---------------------------------------------------------------------------
  // Pointer
  // ---------------------------------------------------------------------------
  /** Screen point relative to the canvas. Works for pointer and wheel events. */
  const pointerPos = (e: { clientX: number; clientY: number; currentTarget: EventTarget }) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const s = sessionRef.current;
    if (!s || s.mode !== "edit") return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = pointerPos(e);

    // The minimap gets first refusal on the click: it sits on top of the
    // canvas, and a click there means "take me there", never "draw a block".
    const renderer = rendererRef.current;
    if (renderer && viewRef.current.showMinimap) {
      const target = renderer.minimapToTile(s.doc, x, y);
      if (target) {
        dragRef.current = "minimap";
        s.centerOn(target.tx, target.ty, renderer.width, renderer.height);
        return;
      }
    }

    const { tx, ty } = s.screenToTile(x, y);

    // Middle button or shift-drag pans. Panning must always be available or a
    // 120-tile level becomes unnavigable.
    if (e.button === 1 || e.shiftKey) {
      dragRef.current = "pan";
      panRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (s.tool === "start") {
      s.placeMarker(MARKER_START, tx, ty);
      syncUi();
      return;
    }
    if (s.tool === "goal") {
      s.placeMarker(MARKER_GOAL, tx, ty);
      syncUi();
      return;
    }
    if (s.tool === "rect") {
      dragRef.current = "rect";
      rectRef.current = { tx0: tx, ty0: ty, tx1: tx, ty1: ty };
      return;
    }

    // Objects (enemies, coins, power-ups) are placed one at a time rather than
    // painted: dragging a row of forty enemies is never what anyone meant.
    const activeDef = partById(s.activePart);
    if (activeDef?.plane === "object" && s.tool !== "eraser") {
      if (e.button === 2) s.removeObjectAt(tx, ty);
      else s.placeObject(activeDef.key, tx, ty);
      syncUi();
      return;
    }
    if (s.tool === "eraser" && s.removeObjectAt(tx, ty)) {
      syncUi();
      return;
    }

    dragRef.current = "paint";
    // Right button always erases, whichever tool is selected -- the fastest fix
    // for a misplaced block without breaking your flow to change tools.
    s.beginStroke(e.button === 2 || s.tool === "eraser" ? "Erase" : "Draw");
    const previousTool = s.tool;
    if (e.button === 2) s.tool = "eraser";
    s.paint(tx, ty);
    if (e.button === 2) s.tool = previousTool;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = sessionRef.current;
    if (!s || s.mode !== "edit") return;
    const { x, y } = pointerPos(e);
    const { tx, ty } = s.screenToTile(x, y);
    cursorRef.current = { tx, ty };

    if (dragRef.current === "minimap") {
      const renderer = rendererRef.current;
      const target = renderer?.minimapToTile(s.doc, x, y);
      // Dragging across the minimap scrubs the view along the level.
      if (target && renderer) s.centerOn(target.tx, target.ty, renderer.width, renderer.height);
      return;
    }
    if (dragRef.current === "pan") {
      s.panBy(e.clientX - panRef.current.x, e.clientY - panRef.current.y);
      panRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (dragRef.current === "rect" && rectRef.current) {
      rectRef.current = { ...rectRef.current, tx1: tx, ty1: ty };
      return;
    }
    if (dragRef.current === "paint") {
      const erasing = (e.buttons & 2) !== 0;
      const previousTool = s.tool;
      if (erasing) s.tool = "eraser";
      s.paint(tx, ty);
      if (erasing) s.tool = previousTool;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = sessionRef.current;
    if (!s) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);

    if (dragRef.current === "rect" && rectRef.current) {
      const r = rectRef.current;
      s.beginStroke("Fill");
      s.fillRect(r.tx0, r.ty0, r.tx1, r.ty1);
      s.endStroke();
      rectRef.current = null;
    } else if (dragRef.current === "paint") {
      s.endStroke();
    }
    dragRef.current = "none";
    syncUi();
  };

  const onWheel = (e: React.WheelEvent) => {
    const s = sessionRef.current;
    const wrap = wrapRef.current;
    if (!s || !wrap || s.mode !== "edit") return;
    const { x, y } = pointerPos(e);
    s.zoomBy(e.deltaY < 0 ? 1 : -1, x, y, wrap.clientWidth, wrap.clientHeight);
  };

  // ---------------------------------------------------------------------------
  // Handlers shared by the docks and the dialogs
  // ---------------------------------------------------------------------------
  const pickPart = (id: number) => {
    const s = sessionRef.current;
    if (!s) return;
    s.activePart = id;
    // Picking a block when the eraser is held means "draw this", not "rub out".
    if (s.tool === "eraser") s.tool = "pencil";
    syncUi();
  };

  const doExport = async () => {
    const s = sessionRef.current;
    if (s?.dirty) await save();
    const all = await levelRepository.list();
    const docs = all.map((r) => r.doc);
    if (docs.length === 0) return;
    downloadBundle(makeBundle(docs), "pixel-forge-levels.json");
    setStatus({ text: `Saved ${docs.length} level(s) to a file`, tone: "good" });
  };

  const doImport = async (file: File) => {
    const parsed = parseBundle(await file.text());
    if ("error" in parsed) {
      setStatus({ text: parsed.error, tone: "warn" });
      return;
    }
    // Fresh ids on import, so bringing a file back never overwrites work that
    // happens to share an id with it.
    let last: LevelDoc | null = null;
    for (const doc of parsed.levels) {
      const copy = { ...doc, id: crypto.randomUUID() };
      await levelRepository.save(copy, getLocalGuestId());
      last = copy;
    }
    if (last) await openDoc(last);
    setStatus({ text: `Added ${parsed.levels.length} level(s)`, tone: "good" });
  };

  const doDelete = async () => {
    const s = sessionRef.current;
    if (!s) return;
    setDialog(null);
    await levelRepository.remove(s.doc.id);
    const remaining = await levelRepository.list();
    await openDoc(remaining[0]?.doc ?? createEmptyLevel(crypto.randomUUID()));
    setStatus({ text: "Level deleted", tone: "info" });
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const playing = ui.mode === "play";
  const errors = ui.issues.filter((i) => i.severity === "error");

  /**
   * Which column of the controls guide opens, and which hint line is printed.
   *
   * `gamepadSeen` is a plain mutable field on InputSource, so React cannot
   * observe it - reading it during render is a snapshot, which is the right
   * shape here because both consumers are one-shot: a dialog the player just
   * opened, and a hint line that only has to be right the next time anything
   * else re-renders. Polling it at 60 Hz to be strictly-correct about a label
   * would cost more than the label is worth.
   */
  const scheme: Scheme = schemeFor(touch.active, inputSource?.gamepadSeen ?? false);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* ---- LAYER 1: THE WORLD ------------------------------------------- */}
      <div
        ref={wrapRef}
        style={{ position: "absolute", inset: 0, background: UI.bgDeep, overflow: "hidden" }}
      >
        <canvas
          ref={editCanvasRef}
          style={{
            position: "absolute",
            inset: 0,
            display: playing ? "none" : "block",
            cursor: ui.tool === "eraser" ? "cell" : "crosshair",
            // Without this a draw-drag on a touch screen is a pinch-scroll.
            touchAction: "none",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            cursorRef.current = { tx: null, ty: null };
          }}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
        <div
          ref={playCanvasRef}
          style={{
            position: "absolute",
            inset: 0,
            display: playing ? "block" : "none",
            background: UI.bgDeep,
          }}
        >
          {/* The canvas positions itself at whole-pixel offsets inside this box
              -- see Renderer.resize. Flex centring would leave it on a half
              pixel, which on a fractional device ratio is visible resampling. */}
          <canvas ref={playCanvasElRef} />
        </div>
      </div>

      {/* ---- LAYER 2: THE CHROME ------------------------------------------ */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {playing ? (
          <PlayControls
            title={ui.title}
            muted={muted}
            touch={touch.active}
            scheme={scheme}
            onBack={stopPlay}
            onHelp={() => setDialog({ kind: "controls" })}
            onRestart={() => {
              sessionRef.current?.restart();
              syncUi();
            }}
            onToggleMute={() => {
              const next = !muted;
              setMuted(next);
              audio.setMuted(next);
            }}
          />
        ) : (
          <>
            <TitlePlaque
              title={ui.title}
              dirty={ui.dirty}
              onRename={() => setDialog({ kind: "rename" })}
            />

            <ViewDock
              canUndo={ui.canUndo}
              canRedo={ui.canRedo}
              showGrid={ui.showGrid}
              showMinimap={ui.showMinimap}
              onUndo={() => {
                sessionRef.current?.undo();
                syncUi();
              }}
              onRedo={() => {
                sessionRef.current?.redo();
                syncUi();
              }}
              onFit={fitToSafeArea}
              onZoom={(delta) => {
                const wrap = wrapRef.current;
                const s = sessionRef.current;
                if (!wrap || !s) return;
                s.zoomBy(
                  delta,
                  wrap.clientWidth / 2,
                  wrap.clientHeight / 2,
                  wrap.clientWidth,
                  wrap.clientHeight,
                );
                syncUi();
              }}
              onToggleGrid={() => {
                viewRef.current.showGrid = !viewRef.current.showGrid;
                setUi((p) => ({ ...p, showGrid: viewRef.current.showGrid }));
              }}
              onToggleMinimap={() => {
                viewRef.current.showMinimap = !viewRef.current.showMinimap;
                setUi((p) => ({ ...p, showMinimap: viewRef.current.showMinimap }));
              }}
              fullscreen={fullscreen}
              onToggleFullscreen={toggleFullscreen}
              onLevels={() => setDialog({ kind: "levels" })}
              onHelp={() => setDialog({ kind: "controls" })}
            />

            <ToolRail
              tool={ui.tool}
              onTool={(tool) => {
                const s = sessionRef.current;
                if (!s) return;
                s.tool = tool;
                syncUi();
              }}
            />

            <PartBelt active={ui.part} onPick={pickPart} />

            <GoDock
              dirty={ui.dirty}
              onPlay={() => startPlay(false)}
              onSave={() => void save()}
            />

            {/* Problems are stated as what to DO, never as an error. They sit
                where the toast does, and the toast wins when both exist. */}
            <div
              style={{
                position: "absolute",
                top: LAYOUT.topDock + LAYOUT.edge * 2,
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 8,
                pointerEvents: "none",
              }}
            >
              {status ? (
                <Toast text={status.text} tone={status.tone} />
              ) : (
                errors.map((issue) => (
                  <Toast key={issue.message} text={issue.message} tone="warn" />
                ))
              )}
            </div>
          </>
        )}

        {/*
         * THE ON-SCREEN CONTROLS, LAST IN THE LAYER AND THEREFORE ON TOP.
         *
         * They live up here in the CHROME rather than down in the world with
         * the canvas, and they are the final child on purpose. When they are
         * up they are the most important control surface in the app, so they
         * have to WIN a hit test against every dock rather than lose one -
         * which is exactly what went wrong: from the world layer they sat
         * under the play dock, and the jump button was 87% dead.
         *
         * Paint order does this. No z-index; the only one in the app belongs
         * to Modal, and it should stay that way.
         *
         * Outside the play/build ternary so the overlay stays mounted and its
         * release effect keeps running when a run ends mid-press.
         */}
        <TouchPad input={inputSource} visible={playing && touch.active} compact={touch.compact} />
      </div>

      {/* ---- LAYER 3: MODALS ---------------------------------------------- */}
      {dialog?.kind === "levels" && (
        <LevelShelf
          library={library}
          currentId={currentId}
          currentTitle={ui.title}
          onClose={() => setDialog(null)}
          onOpen={async (id) => {
            setDialog(null);
            const record = await levelRepository.get(id);
            if (record) await openDoc(record.doc);
          }}
          onNew={() => {
            setDialog(null);
            void openDoc(createEmptyLevel(crypto.randomUUID()));
          }}
          onGreybox={() => {
            setDialog(null);
            // A fresh copy each time, so taking the test room apart never
            // destroys the pristine original.
            void openDoc({ ...buildGreyboxDoc(), id: crypto.randomUUID() });
          }}
          onExport={() => void doExport()}
          onImport={(file) => {
            setDialog(null);
            void doImport(file);
          }}
          onDelete={() => setDialog({ kind: "confirmDelete", title: ui.title })}
        />
      )}

      {dialog?.kind === "rename" && (
        <NamePanel
          initial={ui.title}
          onClose={() => setDialog(null)}
          onSubmit={(title) => {
            const s = sessionRef.current;
            if (s) {
              s.doc.title = title;
              s.markDirty();
            }
            setDialog(null);
            syncUi();
          }}
        />
      )}

      {dialog?.kind === "confirmDelete" && (
        <ConfirmPanel
          title="DELETE THIS LEVEL?"
          message={`"${dialog.title}" will be gone for good. There is no undo for this one.`}
          confirmLabel="Delete"
          onConfirm={() => void doDelete()}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === "controls" && (
        <ControlsGuide
          scheme={scheme}
          compact={touch.compact}
          touchActive={touch.active}
          override={touch.override}
          onSetOverride={touch.setOverride}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Docks
// -----------------------------------------------------------------------------

/** Top-left: who you are and what you are building. */
function TitlePlaque(props: { title: string; dirty: boolean; onRename: () => void }) {
  return (
    <Panel
      className="pf-pop"
      style={{
        position: "absolute",
        top: LAYOUT.edge,
        left: LAYOUT.edge,
        height: LAYOUT.topDock,
        // Fixed rather than shrink-to-fit, so the dock opposite can reserve
        // exactly this much room and a forty-character level name cannot push
        // the plaque into it.
        width: LAYOUT.titlePlaque,
        gap: 12,
        padding: "0 14px",
      }}
    >
      <span
        aria-hidden
        style={{
          ...toneStyle("go"),
          boxShadow: "var(--pf-shadow)",
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: TYPE.display,
          fontSize: 16,
        }}
      >
        P
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        <span
          style={{
            fontFamily: TYPE.display,
            fontSize: 10,
            letterSpacing: TYPE.displayTracking,
            color: UI.textDim,
          }}
        >
          PIXEL FORGE
        </span>
        <button
          type="button"
          className="pf-focus"
          onClick={props.onRename}
          title="Give this level a name"
          style={{
            background: "none",
            border: "none",
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontFamily: TYPE.ui,
            fontSize: 17,
            fontWeight: TYPE.titleWeight,
            color: UI.gold,
            minWidth: 0,
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {props.title}
          </span>
          {/* One pip, two states. Green means everything you made is safe. */}
          <span
            aria-label={props.dirty ? "Not saved yet" : "Saved"}
            style={{
              width: 8,
              height: 8,
              flex: "none",
              background: props.dirty ? UI.warn : UI.go,
              boxShadow: `0 0 0 2px ${UI.ink}`,
            }}
          />
        </button>
      </span>
    </Panel>
  );
}

/** Top-right: fixing mistakes, seeing more, and the level library. */
function ViewDock(props: {
  canUndo: boolean;
  canRedo: boolean;
  showGrid: boolean;
  showMinimap: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFit: () => void;
  onZoom: (delta: number) => void;
  onToggleGrid: () => void;
  onToggleMinimap: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onLevels: () => void;
  onHelp: () => void;
}) {
  return (
    <Panel
      className="pf-pop pf-viewdock"
      style={{
        position: "absolute",
        top: LAYOUT.edge,
        right: LAYOUT.edge,
        // WRAPS RATHER THAN OVERLAPPING.
        //
        // Both top docks are absolutely positioned, so neither can push the
        // other along: below about 800px of width this one simply started
        // painting on top of the title plaque and cut the wordmark in half.
        // Capping the width and letting the controls wrap to a second row keeps
        // them clear of each other at any size.
        maxWidth: `calc(100% - ${LAYOUT.titlePlaque + LAYOUT.edge * 3}px)`,
        minHeight: LAYOUT.topDock,
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: 6,
        padding: "6px 10px",
      }}
    >
      <IconButton icon="undo" label="Undo the last thing (Ctrl+Z)" disabled={!props.canUndo} onClick={props.onUndo} />
      <IconButton icon="redo" label="Put it back (Ctrl+Shift+Z)" disabled={!props.canRedo} onClick={props.onRedo} />
      <Divider />
      <IconButton icon="zoomOut" label="Zoom out (-)" onClick={() => props.onZoom(-1)} />
      <IconButton icon="zoomIn" label="Zoom in (+)" onClick={() => props.onZoom(1)} />
      <IconButton icon="fit" label="See it all (F)" onClick={props.onFit} />
      <Divider />
      <IconButton
        icon="grid"
        label="Show the squares (G)"
        selected={props.showGrid}
        onClick={props.onToggleGrid}
      />
      <IconButton
        icon="map"
        label="Show the level map (M)"
        selected={props.showMinimap}
        onClick={props.onToggleMinimap}
      />
      <IconButton
        icon="expand"
        label={props.fullscreen ? "Leave full screen" : "Fill the whole screen"}
        selected={props.fullscreen}
        onClick={props.onToggleFullscreen}
      />
      <Divider />
      <IconButton icon="help" label="How to play (?)" onClick={props.onHelp} />
      <ActionButton icon="folder" label="Levels" onClick={props.onLevels} title="All your levels" />
    </Panel>
  );
}

/** Left rail: the tool you are holding. */
function ToolRail(props: { tool: Tool; onTool: (t: Tool) => void }) {
  return (
    /**
     * Centred by a WRAPPER, not by a transform on the panel itself.
     *
     * `.pf-pop` animates `transform` with fill-mode `both`, so its final
     * keyframe (`scale(1) translateY(0)`) wins over any inline transform for
     * the life of the element - which silently dropped a `translateY(-50%)`
     * and left the rail hanging half a screen too low. Anything with an
     * entrance animation has to be positioned by its box, never by transform.
     *
     * The wrapper also bounds the rail to the band between the top dock and the
     * part belt, so on a short window FINISH cannot slide off the bottom.
     */
    <div
      className="pf-rail-wrap"
      style={{
        position: "absolute",
        left: LAYOUT.edge,
        top: LAYOUT.topDock + LAYOUT.edge * 2,
        bottom: LAYOUT.bottomBelt + LAYOUT.edge * 2,
        display: "flex",
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
    <Panel
      className="pf-pop"
      style={{
        flexDirection: "column",
        gap: 6,
        padding: 8,
        maxHeight: "100%",
        overflowY: "auto",
      }}
    >
      {(Object.keys(TOOL_META) as Tool[]).map((tool) => (
        <ToolButton
          key={tool}
          icon={TOOL_META[tool].icon}
          label={TOOL_META[tool].label}
          hint={TOOL_META[tool].key}
          selected={props.tool === tool}
          onClick={() => props.onTool(tool)}
          title={`${TOOL_META[tool].hint}   (${TOOL_META[tool].key})`}
        />
      ))}
    </Panel>
    </div>
  );
}

/**
 * Bottom belt: everything you can place.
 *
 * Grouped by plane rather than by category -- things you BUILD with on the
 * left, things you PUT IN on the right -- because that is the distinction that
 * matters while building.
 */
function PartBelt(props: { active: number; onPick: (id: number) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  // True while there is more belt off the right edge. Drives the edge fade, so a phone shows
  // that the row continues, and a wide screen where everything fits shows no fade at all.
  const [more, setMore] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    update();
    el.addEventListener("scroll", update, { passive: true });
    // A mouse wheel scrolls the belt sideways. The one-row belt hides its scrollbar (globals.css),
    // so without this a desktop mouse could not reach the parts past the edge.
    const wheel = (e: WheelEvent) => {
      if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      el.removeEventListener("wheel", wheel);
      ro.disconnect();
    };
  }, []);

  const fade = "linear-gradient(to right, #000 calc(100% - 40px), transparent)";

  return (
    <Panel
      className="pf-pop pf-belt"
      style={{
        position: "absolute",
        left: LAYOUT.leftRail + LAYOUT.edge * 2,
        right: LAYOUT.edge,
        bottom: LAYOUT.edge,
        height: LAYOUT.bottomBelt,
        alignItems: "stretch",
        overflow: "hidden",
      }}
    >
    <div
      ref={scroller}
      className="pf-belt-scroll"
      style={{
        // TWO ROWS: blocks above, things below (one row on a short landscape phone, see
        // globals.css).
        //
        // Sixteen slots do not fit on one row on a normal screen, and the
        // alternative was a horizontal scrollbar - which hides half the parts
        // behind a gesture a young player has no reason to guess at. The two
        // groups were already the right split, so making them two rows costs
        // nothing and means every piece is visible at once.
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 4,
        flex: 1,
        minWidth: 0,
        padding: "0 12px",
        // A phone is narrower than either row, so there the belt scrolls sideways rather than
        // cutting the last parts off. Wider screens fit both rows and never show a scrollbar.
        overflowX: "auto",
        WebkitMaskImage: more ? fade : undefined,
        maskImage: more ? fade : undefined,
      }}
    >
      <Group label="Blocks" pinLabel>
        {tileParts().map((part) => (
          <PartButton
            key={part.id}
            partId={part.id}
            label={part.label}
            short={part.short}
            selected={props.active === part.id}
            onClick={() => props.onPick(part.id)}
          />
        ))}
      </Group>
      <Group label="Things" pinLabel>
        {objectParts().map((part) => (
          <PartButton
            key={part.id}
            partId={part.id}
            label={part.label}
            short={part.short}
            selected={props.active === part.id}
            onClick={() => props.onPick(part.id)}
          />
        ))}
      </Group>
    </div>
    </Panel>
  );
}

/** The one thing a young player is actually here to do, above the belt on the right. */
function GoDock(props: { dirty: boolean; onPlay: () => void; onSave: () => void }) {
  return (
    <div
      className="pf-pop pf-godock"
      style={{
        position: "absolute",
        right: LAYOUT.edge,
        bottom: LAYOUT.bottomBelt + LAYOUT.edge * 2,
        display: "flex",
        alignItems: "center",
        gap: 8,
        pointerEvents: "auto",
      }}
    >
      <IconButton icon="save" label={props.dirty ? "Save now (Ctrl+S)" : "Saved"} onClick={props.onSave} />
      <PlayButton
        playing={false}
        onClick={props.onPlay}
        title="Play your level   (Enter) -- Shift+Enter starts where your cursor is"
      />
    </div>
  );
}

/**
 * Play mode chrome.
 *
 * Almost nothing. The coins and the clock are stamped into the world by the
 * renderer, not printed in a bar here -- see Renderer.drawHud. What is left is
 * the way out and the way to try again.
 *
 * ===========================================================================
 * WHERE THIS DOCK SITS, AND WHY IT MOVES
 * ===========================================================================
 * With a mouse it lives bottom-right, in the way of nothing. With thumbs the
 * bottom-right IS the jump button, and this panel - being one layer up - was
 * silently eating 66 of its 76 pixels. Every jump a tablet player attempted
 * pressed "Build" and threw them back into the editor. That is the whole of
 * the reported bug: "on tablets the user is unable to jump."
 *
 * So on touch it moves to the TOP CENTRE. Not top-right: both bottom corners
 * belong to thumbs and both TOP corners belong to the canvas HUD, which stamps
 * lives and coins at logical x 6..85 and the clock and power pip at x 300..378
 * (Renderer.drawHud). The band between them is free at every scale >= 2, and
 * the letterbox is not always thick enough to hide a corner dock: an 11in iPad
 * in landscape renders at 3x with only 26px of bar above the canvas.
 *
 * Centred by a WRAPPER BOX, never by transform: translateX(-50%). `.pf-pop`
 * animates transform with fill-mode `both`, so its final keyframe wins for the
 * life of the element and drops any inline transform - see the same trap
 * documented at ToolRail, where it left the rail half a screen too low.
 */
function PlayControls(props: {
  title: string;
  muted: boolean;
  /** On-screen controls are up, so the bottom of the screen is spoken for. */
  touch: boolean;
  scheme: Scheme;
  onBack: () => void;
  onRestart: () => void;
  onToggleMute: () => void;
  onHelp: () => void;
}) {
  const dock: CSSProperties = props.touch
    ? {
        position: "absolute",
        top: LAYOUT.edge,
        left: 0,
        right: 0,
        paddingTop: "env(safe-area-inset-top, 0px)",
        justifyContent: "center",
      }
    : {
        position: "absolute",
        right: LAYOUT.edge,
        bottom: LAYOUT.edge,
        paddingRight: "env(safe-area-inset-right, 0px)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        justifyContent: "flex-end",
      };

  return (
    <>
      {/* The wrapper is the thing that positions; the Panel only decorates. */}
      <div style={{ ...dock, display: "flex", pointerEvents: "none" }}>
        <Panel className="pf-pop" style={{ gap: 6, padding: 8 }}>
          <IconButton icon="undo" label="Start the level again (R)" onClick={props.onRestart} />
          <IconButton
            icon={props.muted ? "mute" : "sound"}
            label={props.muted ? "Sound is off" : "Sound is on"}
            selected={!props.muted}
            onClick={props.onToggleMute}
          />
          <IconButton icon="help" label="How to play (?)" onClick={props.onHelp} />
          <Divider />
          <ActionButton icon="pencil" label="Build" onClick={props.onBack} title="Back to building   (Enter)" />
        </Panel>
      </div>

      {/*
       * The title strip.
       *
       * Bottom-left is the d-pad's seat on touch, so it moves to the top there
       * - and on a short landscape phone the canvas reaches almost to the top,
       * so the strip has to earn its place. It does not: the controls are
       * VISIBLE on touch, labelled RUN and JUMP, with a "?" button beside them.
       * A line of text repeating what the buttons already say is clutter laid
       * over the level. So on touch it is the level's name and nothing else.
       *
       * With a keyboard or a pad there is nothing on screen to read, so the
       * hint is the only thing telling you which keys do anything - and its
       * text comes from hintFor, next to the guide it has to agree with, rather
       * than being the hardcoded "ARROWS MOVE - SPACE JUMP" that used to tell
       * tablet players to press keys they do not have.
       */}
      <span
        style={{
          position: "absolute",
          left: LAYOUT.edge + 4,
          ...(props.touch ? { top: LAYOUT.edge } : { bottom: LAYOUT.edge + 6 }),
          fontFamily: TYPE.ui,
          fontSize: TYPE.label,
          fontWeight: TYPE.labelWeight,
          color: UI.text,
          textShadow: textOutline(2),
          pointerEvents: "none",
        }}
      >
        {props.title}
        {!props.touch && (
          // Hidden on a narrow window (globals.css): it runs into the controls dock there.
          <span className="pf-key-hint" style={{ opacity: 0.75, marginLeft: SIZE.gap }}>
            {hintFor(props.scheme)}
          </span>
        )}
      </span>
    </>
  );
}
