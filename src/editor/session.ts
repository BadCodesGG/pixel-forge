import { TILE_PX, fromPx, fromTiles, type Fixed } from "@/engine/math/fixed";
import { compileLevel, validateLevel, type LevelIssue } from "@/engine/level/compile";
import { Sim } from "@/engine/sim";
import { MARKER_GOAL, MARKER_START, makeCell, type LevelDoc } from "@/format/level";
import { partByKey, type PartId } from "@/format/parts";
import { EditorDocument } from "./document";
import {
  CompositeCommand,
  History,
  ObjectCommand,
  PlaceMarkerCommand,
  TileEditCommand,
  type Command,
} from "./commands";

/**
 * THE EDITOR SESSION.
 *
 * Owns the mutable editing state that React must never hold: the document, the
 * undo history, the camera, and the simulation used for test-play.
 *
 * React drives this and reads a small summary from it. Nothing here lives in
 * component state, because a pointer drag mutates thousands of cells and
 * routing that through a re-render would make drawing a floor feel like work.
 */

export type Tool = "pencil" | "eraser" | "rect" | "start" | "goal";
export type Mode = "edit" | "play";

export const ZOOM_LEVELS = [0.25, 0.5, 1, 1.5, 2, 3] as const;
const DEFAULT_ZOOM_INDEX = 2; // 1.0

/**
 * How many objects may share one cell.
 *
 * Three is the tallest pile that still reads at a glance while running at it.
 * Beyond that the top of the stack is off the top of the player's attention,
 * and an obstacle you cannot see coming is not a challenge, it is a surprise.
 */
export const MAX_STACK = 3;

/**
 * Whether a part can take part in a stack.
 *
 * Enemies and items only. A coin tower is fine; markers are unique by
 * definition and never stack.
 */
function isStackable(partKey: string): boolean {
  if (partKey === MARKER_START || partKey === MARKER_GOAL) return false;
  const def = partByKey(partKey);
  return !!def && def.plane === "object";
}

export class EditorSession {
  doc: EditorDocument;
  history = new History();

  tool: Tool = "pencil";
  activePart: PartId = 1; // ground
  mode: Mode = "edit";

  // Typed as plain numbers: ZOOM_LEVELS is `as const`, so inference would pin
  // `zoom` to the literal 1 and reject every other level in the list.
  camera: { x: number; y: number; zoom: number } = {
    x: 0,
    y: 0,
    zoom: ZOOM_LEVELS[DEFAULT_ZOOM_INDEX],
  };
  private zoomIndex = DEFAULT_ZOOM_INDEX;

  /** The gesture currently being recorded, if any. */
  private stroke: TileEditCommand | null = null;
  /** Cells touched during this stroke, so one drag never writes a cell twice. */
  private strokeTouched = new Set<number>();

  /** True when the document has changed since the last save. */
  dirty = false;
  /** Bumped whenever anything a view cares about changes. */
  version = 0;

  sim: Sim;
  issues: LevelIssue[] = [];

  constructor(doc: LevelDoc) {
    this.doc = new EditorDocument(doc);
    this.sim = new Sim(compileLevel(doc));
    this.recomputeIssues();
  }

  private touch(): void {
    this.dirty = true;
    this.version += 1;
  }

  // -------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------

  /** Convert a screen point to a tile coordinate. */
  screenToTile(screenX: number, screenY: number): { tx: number; ty: number } {
    return {
      tx: Math.floor((screenX / this.camera.zoom + this.camera.x) / TILE_PX),
      ty: Math.floor((screenY / this.camera.zoom + this.camera.y) / TILE_PX),
    };
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.camera.x -= dxScreen / this.camera.zoom;
    this.camera.y -= dyScreen / this.camera.zoom;
    this.clampCamera();
    this.version += 1;
  }

  /**
   * Zoom in discrete steps, keeping the point under the cursor fixed.
   *
   * Discrete rather than continuous because tiles are square and a person is
   * aiming at them; and anchoring on the cursor is what makes zoom feel like
   * moving a magnifying glass rather than like the level jumping away.
   */
  zoomBy(delta: number, anchorX: number, anchorY: number, viewW: number, viewH: number): void {
    const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, this.zoomIndex + delta));
    if (next === this.zoomIndex) return;

    const worldX = anchorX / this.camera.zoom + this.camera.x;
    const worldY = anchorY / this.camera.zoom + this.camera.y;
    this.zoomIndex = next;
    this.camera.zoom = ZOOM_LEVELS[next];
    this.camera.x = worldX - anchorX / this.camera.zoom;
    this.camera.y = worldY - anchorY / this.camera.zoom;
    this.clampCamera(viewW, viewH);
    this.version += 1;
  }

  /** Put a tile in the middle of the view. Backs minimap click-to-jump. */
  centerOn(tx: number, ty: number, viewW: number, viewH: number): void {
    this.camera.x = tx * TILE_PX - viewW / this.camera.zoom / 2;
    this.camera.y = ty * TILE_PX - viewH / this.camera.zoom / 2;
    this.clampCamera(viewW, viewH);
    this.version += 1;
  }

  /** Fit the whole level in view. The answer to "where am I?". */
  zoomToFit(viewW: number, viewH: number): void {
    const fit = Math.min(
      viewW / (this.doc.width * TILE_PX),
      viewH / (this.doc.height * TILE_PX),
    );
    let best = 0;
    for (let i = 0; i < ZOOM_LEVELS.length; i++) if (ZOOM_LEVELS[i] <= fit) best = i;
    this.zoomIndex = best;
    this.camera.zoom = ZOOM_LEVELS[best];
    this.camera.x = (this.doc.width * TILE_PX - viewW / this.camera.zoom) / 2;
    this.camera.y = (this.doc.height * TILE_PX - viewH / this.camera.zoom) / 2;
    this.clampCamera(viewW, viewH);
    this.version += 1;
  }

  private clampCamera(viewW = 0, viewH = 0): void {
    const worldW = this.doc.width * TILE_PX;
    const worldH = this.doc.height * TILE_PX;
    const visibleW = viewW / this.camera.zoom;
    const visibleH = viewH / this.camera.zoom;
    // A margin of one screen keeps the level's edge reachable without letting
    // it be lost off in blank space.
    const maxX = Math.max(0, worldW - visibleW * 0.5);
    const maxY = Math.max(0, worldH - visibleH * 0.5);
    this.camera.x = Math.max(-visibleW * 0.25, Math.min(maxX, this.camera.x));
    this.camera.y = Math.max(-visibleH * 0.25, Math.min(maxY, this.camera.y));
  }

  // -------------------------------------------------------------------------
  // Editing gestures
  // -------------------------------------------------------------------------

  /**
   * Begin a gesture. Everything until `endStroke` becomes ONE undo entry.
   *
   * Without this, undoing a single pencil drag takes forty presses of ctrl+Z.
   */
  beginStroke(label: string): void {
    this.stroke = new TileEditCommand(label);
    this.strokeTouched.clear();
  }

  /**
   * Place or remove an object (enemy, coin, power-up) at a tile.
   *
   * Objects are a separate plane from tiles, so placing one never disturbs the
   * terrain under it: you can drop an enemy onto ground without erasing the
   * ground, which is what a person expects and what the two-plane model buys.
   */
  placeObject(partKey: string, tx: number, ty: number): void {
    if (!this.doc.inBounds(tx, ty)) return;

    const steps: Command[] = [];
    const occupants = this.doc
      .objectsAt(tx, ty)
      .filter((o) => o.part !== MARKER_START && o.part !== MARKER_GOAL);

    /**
     * STACKING.
     *
     * This used to replace whatever was in the cell, on the grounds that
     * "stacked invisible duplicates are impossible to notice and impossible to
     * remove". Both halves of that were true and both are now fixed: the editor
     * draws a stack fanned out so you can see it (see EditorRenderer.drawObjects)
     * and the eraser takes the top one off first, so a pile comes apart the way
     * it went together.
     *
     * Stacking is still refused in the two cases where it would only ever be a
     * mistake: putting the SAME thing on itself, and piling higher than three,
     * which is taller than the player can see coming.
     */
    const top = occupants[occupants.length - 1];
    const canStack =
      occupants.length > 0 &&
      occupants.length < MAX_STACK &&
      top.part !== partKey &&
      isStackable(partKey) &&
      occupants.every((o) => isStackable(o.part));

    if (occupants.length > 0 && !canStack) {
      const remove = new ObjectCommand("remove", top.part, tx, ty, top.id);
      remove.apply(this.doc);
      steps.push(remove);
    }
    const add = new ObjectCommand("add", partKey, tx, ty);
    add.apply(this.doc);
    steps.push(add);

    // One click, one undo entry, even though it was two operations.
    this.history.push(
      steps.length === 1 ? steps[0] : new CompositeCommand(`Place ${partKey}`, steps),
    );
    this.touch();
    this.recomputeIssues();
  }

  removeObjectAt(tx: number, ty: number): boolean {
    // The TOP of the stack, so a pile comes apart in the reverse of the order
    // it was built. Taking from the bottom would look like the wrong thing
    // vanished.
    const stack = this.doc.objectsAt(tx, ty);
    const existing = stack[stack.length - 1];
    if (!existing) return false;
    // Markers are moved, never deleted: a level with no start is a level that
    // needs one, so removing it just creates a problem to be told about later.
    if (existing.part === MARKER_START || existing.part === MARKER_GOAL) return false;

    const command = new ObjectCommand("remove", existing.part, tx, ty, existing.id);
    command.apply(this.doc);
    this.history.push(command);
    this.touch();
    this.recomputeIssues();
    return true;
  }

  paint(tx: number, ty: number): void {
    if (!this.stroke || !this.doc.inBounds(tx, ty)) return;
    const key = ty * this.doc.width + tx;
    // A pointer drag revisits the same cell many times; writing once keeps the
    // undo record proportional to the area painted, not to mouse jitter.
    if (this.strokeTouched.has(key)) return;
    this.strokeTouched.add(key);

    const part = this.tool === "eraser" ? 0 : this.activePart;
    const cell = part === 0 ? 0 : makeCell(part);
    const before = this.doc.setCell(tx, ty, cell);
    this.stroke.record(tx, ty, before, cell);
    this.touch();
  }

  fillRect(tx0: number, ty0: number, tx1: number, ty1: number): void {
    if (!this.stroke) this.beginStroke("Fill");
    const x0 = Math.min(tx0, tx1);
    const x1 = Math.max(tx0, tx1);
    const y0 = Math.min(ty0, ty1);
    const y1 = Math.max(ty0, ty1);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) this.paint(tx, ty);
  }

  /** Commit the gesture. A gesture that changed nothing leaves no undo entry. */
  endStroke(): void {
    if (!this.stroke) return;
    if (this.stroke.size > 0) {
      this.history.push(this.stroke);
      this.recomputeIssues();
    }
    this.stroke = null;
    this.strokeTouched.clear();
    this.version += 1;
  }

  placeMarker(part: typeof MARKER_START | typeof MARKER_GOAL, tx: number, ty: number): void {
    if (!this.doc.inBounds(tx, ty)) return;
    const command = new PlaceMarkerCommand(part, tx, ty);
    command.apply(this.doc);
    this.history.push(command);
    this.touch();
    this.recomputeIssues();
  }

  undo(): void {
    if (this.history.undo(this.doc)) {
      this.touch();
      this.recomputeIssues();
    }
  }

  redo(): void {
    if (this.history.redo(this.doc)) {
      this.touch();
      this.recomputeIssues();
    }
  }

  // -------------------------------------------------------------------------
  // Test play
  // -------------------------------------------------------------------------

  /**
   * Enter test-play, optionally spawning at a chosen tile.
   *
   * TEST-PLAY IS NEVER GATED BY VALIDATION. A level without a goal still runs;
   * it just cannot be won. Refusing to run an unfinished level breaks the only
   * loop that matters (build a bit, try it, build more) and is the fastest
   * way to make an editor unpleasant to use.
   *
   * "Play from here" matters more than it sounds: without it, testing a change
   * at the far end of a level means walking the whole level from the start,
   * every single time.
   */
  play(fromTile?: { tx: number; ty: number }): void {
    const compiled = compileLevel(this.doc.toDoc());
    this.sim.loadArea(compiled, this.doc.timeLimit);
    if (fromTile) {
      // A transient spawn: deliberately NOT written to the document, so
      // testing from a spot never moves the real start flag.
      this.sim.player.x = (fromTiles(fromTile.tx) + fromPx(TILE_PX / 2)) as Fixed;
      this.sim.player.y = fromTiles(fromTile.ty);
    }
    this.mode = "play";
    this.version += 1;
  }

  stopPlaying(): void {
    this.mode = "edit";
    this.version += 1;
  }

  restart(): void {
    this.sim.respawn();
    this.sim.cleared = false;
    this.version += 1;
  }

  // -------------------------------------------------------------------------

  recomputeIssues(): void {
    this.issues = validateLevel(this.doc.toDoc());
  }

  markSaved(): void {
    this.dirty = false;
    this.version += 1;
  }

  /** Flag unsaved changes made outside a stroke, such as a rename. */
  markDirty(): void {
    this.touch();
  }

  /** Blocking problems. Publishing is gated on this; test-play never is. */
  get blockingIssues(): LevelIssue[] {
    return this.issues.filter((i) => i.severity === "error");
  }
}
