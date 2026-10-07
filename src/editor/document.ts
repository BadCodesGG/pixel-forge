import {
  FORMAT_VERSION,
  MARKER_GOAL,
  MARKER_START,
  MIN_READER_VERSION,
  cellPart,
  makeCell,
  type AreaDoc,
  type LevelDoc,
  type ObjectDoc,
  type TileCell,
} from "@/format/level";
import type { PartId } from "@/format/parts";

/**
 * THE EDIT-TIME DOCUMENT.
 *
 * LevelDoc is the SERIALIZATION shape: immutable, JSON-friendly, hashable.
 * This is the EDITING shape: a flat Uint16Array plus a Map of objects, mutated
 * in place.
 *
 * WHY THE SPLIT (and please do not "simplify" it away):
 * a pencil drag or a rectangle fill touches thousands of cells in a single
 * gesture. Rebuilding an immutable array per cell is quadratic on exactly the
 * operation a young player performs most, and the editor would visibly stutter while
 * drawing a floor. Materialising the immutable document happens once, on save.
 *
 * The same reasoning is why undo is a command stack over this grid rather than
 * a stack of document snapshots: a snapshot of a 120x27 level is 3240 cells,
 * and 200 levels of undo history would be 648,000 cells of garbage.
 */
export class EditorDocument {
  readonly width: number;
  readonly height: number;
  readonly tiles: Uint16Array;

  private objects = new Map<number, ObjectDoc>();
  private nextObjectId = 1;

  /** Bumped on every mutation, so views can cheaply detect staleness. */
  revision = 0;

  id: string;
  title: string;
  timeLimit: number;

  constructor(doc: LevelDoc) {
    const area = doc.areas[0];
    this.width = area.w;
    this.height = area.h;
    this.tiles = Uint16Array.from(area.tiles);
    this.id = doc.id;
    this.title = doc.title;
    this.timeLimit = doc.timeLimit;

    for (const obj of area.objects) {
      this.objects.set(obj.id, obj);
      this.nextObjectId = Math.max(this.nextObjectId, obj.id + 1);
    }
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && tx < this.width && ty >= 0 && ty < this.height;
  }

  index(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  cellAt(tx: number, ty: number): TileCell {
    if (!this.inBounds(tx, ty)) return 0;
    return this.tiles[this.index(tx, ty)];
  }

  partAt(tx: number, ty: number): PartId {
    return cellPart(this.cellAt(tx, ty));
  }

  /** Write a cell. Returns the previous value so a command can undo it. */
  setCell(tx: number, ty: number, cell: TileCell): TileCell {
    if (!this.inBounds(tx, ty)) return 0;
    const i = this.index(tx, ty);
    const previous = this.tiles[i];
    if (previous !== cell) {
      this.tiles[i] = cell;
      this.revision += 1;
    }
    return previous;
  }

  setPart(tx: number, ty: number, part: PartId, variant = 0): TileCell {
    return this.setCell(tx, ty, part === 0 ? 0 : makeCell(part, variant));
  }

  // -------------------------------------------------------------------------
  // Objects
  // -------------------------------------------------------------------------

  allObjects(): ObjectDoc[] {
    return [...this.objects.values()];
  }

  objectAt(tx: number, ty: number): ObjectDoc | undefined {
    for (const obj of this.objects.values()) {
      if (obj.tx === tx && obj.ty === ty) return obj;
    }
    return undefined;
  }

  /**
   * Every object in a cell, in the order they were placed.
   *
   * Objects have always been keyed by their own id rather than by cell, so more
   * than one has always been representable; this is what makes a deliberate
   * stack readable by the editor and the compiler instead of an accident.
   * Index 0 is on the floor, the last one is on top.
   */
  objectsAt(tx: number, ty: number): ObjectDoc[] {
    const found: ObjectDoc[] = [];
    for (const obj of this.objects.values()) {
      if (obj.tx === tx && obj.ty === ty) found.push(obj);
    }
    return found.sort((a, b) => a.id - b.id);
  }

  findByPart(part: string): ObjectDoc | undefined {
    for (const obj of this.objects.values()) {
      if (obj.part === part) return obj;
    }
    return undefined;
  }

  /**
   * Place a unique marker, moving the existing one rather than adding a second.
   *
   * A level has exactly one start and one goal. Enforcing that here (rather
   * than validating it afterwards) means the editor can never get into a state
   * the author has to be told to fix.
   */
  placeMarker(part: string, tx: number, ty: number): { id: number; previous?: ObjectDoc } {
    const existing = this.findByPart(part);
    if (existing) {
      const previous = { ...existing };
      this.objects.set(existing.id, { ...existing, tx, ty });
      this.revision += 1;
      return { id: existing.id, previous };
    }
    const id = this.nextObjectId++;
    this.objects.set(id, { id, part, tx, ty });
    this.revision += 1;
    return { id };
  }

  addObject(part: string, tx: number, ty: number): ObjectDoc {
    const obj: ObjectDoc = { id: this.nextObjectId++, part, tx, ty };
    this.objects.set(obj.id, obj);
    this.revision += 1;
    return obj;
  }

  setObject(obj: ObjectDoc): void {
    this.objects.set(obj.id, obj);
    this.revision += 1;
  }

  removeObject(id: number): ObjectDoc | undefined {
    const existing = this.objects.get(id);
    if (existing) {
      this.objects.delete(id);
      this.revision += 1;
    }
    return existing;
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /** Materialise the immutable document. Called on save, hash, share, export. */
  toDoc(): LevelDoc {
    const area: AreaDoc = {
      w: this.width,
      h: this.height,
      tiles: Array.from(this.tiles),
      // Sorted by id so the output is stable: an unstable order would change
      // the content hash on every save even when nothing was edited.
      objects: this.allObjects().sort((a, b) => a.id - b.id),
    };
    return {
      format: FORMAT_VERSION,
      minReader: MIN_READER_VERSION,
      id: this.id,
      title: this.title,
      timeLimit: this.timeLimit,
      areas: [area],
    };
  }

  hasStart(): boolean {
    return this.findByPart(MARKER_START) !== undefined;
  }

  hasGoal(): boolean {
    return this.findByPart(MARKER_GOAL) !== undefined;
  }
}
