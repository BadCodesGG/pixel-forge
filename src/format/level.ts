import { AREA_H, AREA_MAX_W } from "@/engine/core/constants";
import type { PartId } from "./parts";

/**
 * THE COURSE DOCUMENT.
 *
 * This is what a level IS: the thing the editor edits, IndexedDB stores, the
 * compiler turns into a runtime world, and the export file carries. There is
 * deliberately no second representation.
 *
 * ---------------------------------------------------------------------------
 * FORWARD-COMPATIBILITY CONTRACT
 * ---------------------------------------------------------------------------
 * Levels outlive code. A new player will make sixty of them, and any change that
 * cannot read those sixty is not a change we are allowed to make. So:
 *
 *   1. Never remove or retype a field. Add OPTIONAL fields only.
 *   2. Part ids are append-only (see parts.ts).
 *   3. Bump FORMAT_VERSION for additive changes. Bump MIN_READER_VERSION only
 *      when an older reader would produce a WRONG level rather than a poorer
 *      one, so it then opens read-only instead of silently corrupting.
 *
 * ---------------------------------------------------------------------------
 * COORDINATES
 * ---------------------------------------------------------------------------
 * Tile coordinates here are ROW-MAJOR with the origin at the TOP-LEFT, matching
 * the simulation. A bottom-left origin would match how people think about
 * building, but carrying two conventions means every reader has to know which
 * one it is holding. One convention, chosen once.
 */

export const FORMAT_VERSION = 1;
export const MIN_READER_VERSION = 1;

export type LevelId = string;

/**
 * One authored terrain cell, packed into a single number.
 *
 * The low bits are the part id; the high bits are an author override of the
 * auto-chosen visual variant. They are packed together because the tile grid is
 * a Uint16Array of these values: one array, one allocation, and a variant that
 * cannot get separated from the part it belongs to.
 *
 * Keeping the variant IS load-bearing: it is what the author sets when
 * autotiling picks an ugly corner. Dropping it on save means they fix the
 * corner, share the level, and the recipient sees the ugly corner again.
 */
export type TileCell = number;

/** Parts occupy the low 12 bits (up to 4095 of them); variants the high 4. */
export const PART_SPAN = 4096;

export function makeCell(part: PartId, variant = 0): TileCell {
  return part + variant * PART_SPAN;
}
export function cellPart(cell: TileCell): PartId {
  return cell % PART_SPAN;
}
export function cellVariant(cell: TileCell): number {
  return Math.floor(cell / PART_SPAN);
}

/** Non-terrain things: the start marker, the goal, later enemies and items. */
export interface ObjectDoc {
  readonly id: number;
  readonly part: string;
  /** Tile coordinates. Objects snap to the grid in v1. */
  readonly tx: number;
  readonly ty: number;
}

export interface AreaDoc {
  readonly w: number;
  readonly h: number;
  /**
   * Row-major tile grid, length w*h. Stored as a plain array in JSON and as a
   * Uint16Array in memory; the codec converts.
   */
  readonly tiles: readonly TileCell[];
  readonly objects: readonly ObjectDoc[];
}

export interface LevelDoc {
  readonly format: number;
  readonly minReader: number;
  readonly id: LevelId;
  readonly title: string;
  /** Exactly one area in v1. The array shape reserves room for a sub-area. */
  readonly areas: readonly [AreaDoc];
  readonly timeLimit: number;
}

/**
 * Persistence envelope.
 *
 * Deliberately separate from LevelDoc so that bookkeeping never changes the
 * document's content hash. Putting `updatedAt` inside the document means every
 * autosave produces a new hash even when nothing was edited, which invalidates
 * the "you beat your own level" proof and makes the player re-clear a level
 * because they panned the camera.
 */
export interface StoredLevel {
  readonly id: LevelId;
  readonly doc: LevelDoc;
  readonly ownerId: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly rev: number;
}

export const DEFAULT_AREA_W = 120;
export const DEFAULT_AREA_H = AREA_H;
export const MAX_AREA_W = AREA_MAX_W;

/** Marker part keys. Objects, not tiles: there is exactly one of each. */
export const MARKER_START = "startMarker";
export const MARKER_GOAL = "goalPole";

/**
 * A brand-new level: floor, a start marker and a goal.
 *
 * NEVER an empty grid. A blank 120x27 canvas is intimidating and gives a young player
 * nothing to react to; a floor with a start and a finish is immediately a
 * (very short) game they can press play on and then change. This is the
 * cheapest onboarding lever available and it costs one function.
 */
export function createEmptyLevel(id: LevelId, title = "My level"): LevelDoc {
  const w = DEFAULT_AREA_W;
  const h = DEFAULT_AREA_H;
  const tiles = new Array<TileCell>(w * h).fill(0);

  const floorTop = h - 5;
  for (let ty = floorTop; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) tiles[ty * w + tx] = makeCell(1); // ground
  }

  return {
    format: FORMAT_VERSION,
    minReader: MIN_READER_VERSION,
    id,
    title,
    timeLimit: 300,
    areas: [
      {
        w,
        h,
        tiles,
        objects: [
          { id: 1, part: MARKER_START, tx: 3, ty: floorTop - 1 },
          { id: 2, part: MARKER_GOAL, tx: 28, ty: floorTop - 1 },
        ],
      },
    ],
  };
}

/**
 * Content hash: covers authored content ONLY.
 *
 * Note what is absent: id, title, timestamps, revision. Two levels with the
 * same geometry hash the same regardless of when they were saved or what they
 * are called, which is what makes "has this actually changed since it was
 * verified?" answerable.
 *
 * FNV-1a: not cryptographic, and does not need to be. It answers "did the
 * bytes change", not "did someone tamper with them".
 */
export function contentHash(doc: LevelDoc): string {
  let hash = 0x811c9dc5;
  const mix = (n: number) => {
    hash ^= n & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= (n >>> 8) & 0xff;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };
  for (const area of doc.areas) {
    mix(area.w);
    mix(area.h);
    for (const cell of area.tiles) mix(cell);
    for (const obj of area.objects) {
      mix(obj.tx);
      mix(obj.ty);
      for (let i = 0; i < obj.part.length; i++) mix(obj.part.charCodeAt(i));
    }
  }
  mix(doc.timeLimit);
  return hash.toString(16).padStart(8, "0");
}
