import type { ObjectDoc, TileCell } from "@/format/level";
import type { EditorDocument } from "./document";

/**
 * UNDO/REDO.
 *
 * Every mutation goes through a Command that records exactly what it changed,
 * so undoing is replaying the inverse rather than restoring a snapshot.
 *
 * THIS IS THE FEATURE A YOUNG PLAYER WILL USE MOST. Building a level is mostly
 * mistakes (a fill in the wrong place, a floor drawn one row too high) and an
 * editor without a reliable undo teaches you to be afraid of it. So it stores
 * the minimum needed to reverse each edit, which keeps a deep history cheap:
 * one drag across 500 tiles costs 500 small records, not 500 copies of the level.
 */

export interface Command {
  readonly label: string;
  undo(doc: EditorDocument): void;
  redo(doc: EditorDocument): void;
}

interface TileEdit {
  tx: number;
  ty: number;
  before: TileCell;
  after: TileCell;
}

/**
 * A batch of tile writes, built up during one gesture.
 *
 * COALESCING IS THE POINT. A pencil drag fires dozens of pointer-move events; a
 * naive implementation pushes one undo entry per event, so undoing a single
 * stroke takes forty presses of ctrl+Z. The whole gesture, press to release,
 * is one entry.
 */
export class TileEditCommand implements Command {
  private edits: TileEdit[] = [];
  constructor(readonly label: string) {}

  /** Record a write that has ALREADY been applied to the document. */
  record(tx: number, ty: number, before: TileCell, after: TileCell): void {
    if (before === after) return;
    this.edits.push({ tx, ty, before, after });
  }

  get size(): number {
    return this.edits.length;
  }

  undo(doc: EditorDocument): void {
    // Reverse order, so overlapping writes within one gesture unwind correctly:
    // painting over the same cell twice must restore the ORIGINAL value.
    for (let i = this.edits.length - 1; i >= 0; i--) {
      const e = this.edits[i];
      doc.setCell(e.tx, e.ty, e.before);
    }
  }

  redo(doc: EditorDocument): void {
    for (const e of this.edits) doc.setCell(e.tx, e.ty, e.after);
  }
}

/** Move (or first-place) a unique marker such as the start or goal. */
export class PlaceMarkerCommand implements Command {
  readonly label: string;
  private objectId = 0;
  private previous?: ObjectDoc;

  constructor(
    private part: string,
    private tx: number,
    private ty: number,
    label?: string,
  ) {
    this.label = label ?? `Move ${part}`;
  }

  apply(doc: EditorDocument): void {
    const { id, previous } = doc.placeMarker(this.part, this.tx, this.ty);
    this.objectId = id;
    this.previous = previous;
  }

  undo(doc: EditorDocument): void {
    if (this.previous) doc.setObject(this.previous);
    else doc.removeObject(this.objectId);
  }

  redo(doc: EditorDocument): void {
    doc.placeMarker(this.part, this.tx, this.ty);
  }
}

/**
 * Add or remove a non-unique object: an enemy, a coin, a power-up.
 *
 * Separate from PlaceMarkerCommand because markers MOVE (there is exactly one
 * start) while these are created and destroyed. Both need to be undoable: a
 * young player places an enemy, decides against it, and presses Ctrl+Z expecting the
 * same thing to happen as when they draw a block. An editor where undo covers
 * some edits and silently skips others is worse than one with no undo, because
 * you cannot trust it.
 */
export class ObjectCommand implements Command {
  readonly label: string;

  constructor(
    private mode: "add" | "remove",
    private part: string,
    private tx: number,
    private ty: number,
    private objectId = 0,
  ) {
    this.label = mode === "add" ? `Place ${part}` : `Remove ${part}`;
  }

  apply(doc: EditorDocument): void {
    if (this.mode === "add") this.objectId = doc.addObject(this.part, this.tx, this.ty).id;
    else doc.removeObject(this.objectId);
  }

  undo(doc: EditorDocument): void {
    if (this.mode === "add") doc.removeObject(this.objectId);
    else doc.setObject({ id: this.objectId, part: this.part, tx: this.tx, ty: this.ty });
  }

  redo(doc: EditorDocument): void {
    this.apply(doc);
  }
}

/**
 * Several commands that undo and redo as one.
 *
 * Placing an object over an existing one is a remove plus an add; without this
 * it would take two presses of Ctrl+Z to reverse a single click.
 */
export class CompositeCommand implements Command {
  constructor(
    readonly label: string,
    private parts: Command[],
  ) {}

  undo(doc: EditorDocument): void {
    for (let i = this.parts.length - 1; i >= 0; i--) this.parts[i].undo(doc);
  }

  redo(doc: EditorDocument): void {
    for (const part of this.parts) part.redo(doc);
  }
}

/**
 * Bounded undo history.
 *
 * The bound matters on a device with limited memory, and 200 is far past what
 * anyone reaches for in one sitting. Dropping the OLDEST entry when full is
 * deliberate: the recent past is what people want back.
 */
export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];

  constructor(private readonly limit = 200) {}

  push(command: Command): void {
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    // Any new edit invalidates the redo branch: the future you could have had
    // is not the future you are now in.
    this.redoStack.length = 0;
  }

  undo(doc: EditorDocument): Command | undefined {
    const command = this.undoStack.pop();
    if (!command) return undefined;
    command.undo(doc);
    this.redoStack.push(command);
    return command;
  }

  redo(doc: EditorDocument): Command | undefined {
    const command = this.redoStack.pop();
    if (!command) return undefined;
    command.redo(doc);
    this.undoStack.push(command);
    return command;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get depth(): number {
    return this.undoStack.length;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
