import { TILE, toTile, type Fixed } from "../math/fixed";
import { TileFlags, hasAny } from "../core/flags";
import { Shape, type ShapeId } from "./tileShapes";

/**
 * The baked collision grid for one area.
 *
 * Produced by `compile()` from the authored level document and then treated as
 * read-only by the simulation. Two parallel arrays (geometry and material)
 * indexed row-major.
 *
 * Out-of-bounds reads are answered rather than rejected, because collision code
 * constantly samples the tiles around an actor and half of them fall outside
 * the level at the edges. Making every caller bounds-check would be noise, and
 * a forgotten check would be a crash. The answers are chosen so the level
 * behaves the way a player expects: walls on the sides, a ceiling above, and
 * open air below so falling off the bottom is a pit rather than a floor.
 */
export class Tilemap {
  readonly width: number;
  readonly height: number;
  readonly shape: Uint8Array;
  readonly flags: Uint16Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.shape = new Uint8Array(width * height);
    this.flags = new Uint16Array(width * height);
  }

  index(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && tx < this.width && ty >= 0 && ty < this.height;
  }

  /** Shape at a tile. Outside the level: solid at the sides and top, empty below. */
  shapeAt(tx: number, ty: number): ShapeId {
    if (ty >= this.height) return Shape.EMPTY; // the pit
    if (tx < 0 || tx >= this.width || ty < 0) return Shape.FULL; // walls and ceiling
    return this.shape[this.index(tx, ty)];
  }

  /** Material flags at a tile, with the same out-of-bounds policy as `shapeAt`. */
  flagsAt(tx: number, ty: number): number {
    if (ty >= this.height) return TileFlags.NONE;
    if (tx < 0 || tx >= this.width || ty < 0) return TileFlags.SOLID;
    return this.flags[this.index(tx, ty)];
  }

  /** True if this tile blocks movement from every direction. */
  isSolid(tx: number, ty: number): boolean {
    return hasAny(this.flagsAt(tx, ty), TileFlags.SOLID);
  }

  /** True if this tile blocks only downward movement from above (semisolid). */
  isOneWay(tx: number, ty: number): boolean {
    return hasAny(this.flagsAt(tx, ty), TileFlags.ONE_WAY);
  }

  set(tx: number, ty: number, shape: ShapeId, flags: number): void {
    if (!this.inBounds(tx, ty)) return;
    const i = this.index(tx, ty);
    this.shape[i] = shape;
    this.flags[i] = flags;
  }

  /** Fill a rectangle, inclusive of both corners. Used by tests and the compiler. */
  fill(tx0: number, ty0: number, tx1: number, ty1: number, shape: ShapeId, flags: number): void {
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) this.set(tx, ty, shape, flags);
    }
  }

  clear(): void {
    this.shape.fill(Shape.EMPTY);
    this.flags.fill(TileFlags.NONE);
  }

  // -------------------------------------------------------------------------
  // Coordinate helpers
  // -------------------------------------------------------------------------

  /** World X of a tile's left edge. */
  static tileLeft(tx: number): Fixed {
    return (tx * TILE) as Fixed;
  }

  /** World Y of a tile's top edge. */
  static tileTop(ty: number): Fixed {
    return (ty * TILE) as Fixed;
  }

  /**
   * Tile column containing a world X.
   *
   * Uses floor rather than truncation so the grid stays monotone across zero:
   * see the rounding-convention note in math/fixed.ts.
   */
  static tileX(x: Fixed): number {
    return toTile(x);
  }

  static tileY(y: Fixed): number {
    return toTile(y);
  }

  /**
   * Tile column containing the RIGHT or BOTTOM edge of a box.
   *
   * The subtraction of one unit is the single most important line in tile
   * collision. An edge sitting exactly on a tile boundary belongs to the tile
   * it is leaving, not the one it is entering. Without this, a box resting
   * flush on a floor claims to overlap the row below it, and the resolver
   * pushes it out of a tile it was never inside, which presents as the player
   * mysteriously sticking or juddering on perfectly flat ground.
   */
  static tileXExclusive(x: Fixed): number {
    return toTile((x - 1) as Fixed);
  }

  static tileYExclusive(y: Fixed): number {
    return toTile((y - 1) as Fixed);
  }
}
