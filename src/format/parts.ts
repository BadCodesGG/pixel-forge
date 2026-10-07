import { TileFlags, combine } from "@/engine/core/flags";
import { Shape, type ShapeId } from "@/engine/collision/tileShapes";

/**
 * THE PART REGISTRY.
 *
 * Every placeable thing in the game is a row in this table, not a branch in a
 * switch statement. Adding a part means adding data; nothing in the compiler,
 * the editor palette or the renderer needs to learn about it.
 *
 * ---------------------------------------------------------------------------
 * NUMERIC IDS ARE AN APPEND-ONLY CONTRACT
 * ---------------------------------------------------------------------------
 * The number is what goes on the wire and into saved levels. Once a part has
 * shipped, its id belongs to it forever: renaming the part is fine, reusing or
 * renumbering the id silently rewrites every level anyone has already made.
 *
 * To retire a part, leave the entry in place and mark it `retired` so the id is
 * never handed out again. `level.test.ts` asserts ids and keys stay unique.
 */

export type PartId = number;

export interface PartDef {
  readonly id: PartId;
  /** Stable machine key. Safe to rename the label; never rename this. */
  readonly key: string;
  /** What the palette shows a person: the full name, in the chip's tooltip. */
  readonly label: string;
  /**
   * A shorter name for the 56 px palette chip, when the full one does not fit. The chip wraps at
   * spaces onto at most two lines of eight characters, and the full label is its accessible name,
   * so this must be a word (or words) taken from the full label.
   */
  readonly short?: string;
  readonly category: "terrain" | "hazard" | "enemy" | "item" | "marker";
  /**
   * How this part is stored.
   *
   * TILES live in the packed grid: cheap, thousands of them, no per-instance
   * state. OBJECTS live in a list and become entities at runtime, because they
   * move and remember things. Keeping them in separate planes is what lets a
   * level hold 3000 tiles and still stream enemies efficiently.
   */
  readonly plane: "tile" | "object";
  /** Collision outline. Tiles only. */
  readonly shape: ShapeId;
  /** Material properties. Tiles only. */
  readonly flags: number;
  /** Palette swatch colour, and the greybox render colour. */
  readonly color: string;
  /** A lighter cap drawn on a walkable surface, when it has one. */
  readonly topColor?: string;
  /** Retired parts keep their id reserved but never appear in the palette. */
  readonly retired?: boolean;
}

const SOLID = combine(TileFlags.SOLID, TileFlags.SCROLL_STOP);

const tile = (
  id: number,
  key: string,
  label: string,
  category: PartDef["category"],
  shape: ShapeId,
  flags: number,
  color: string,
  topColor?: string,
): PartDef => ({ id, key, label, category, plane: "tile", shape, flags, color, topColor });

const object = (
  id: number,
  key: string,
  label: string,
  category: PartDef["category"],
  color: string,
): PartDef => ({
  id,
  key,
  label,
  category,
  plane: "object",
  shape: Shape.EMPTY,
  flags: TileFlags.NONE,
  color,
});

/**
 * Ids 1-99 are terrain tiles; 100+ are objects.
 *
 * Id 0 is reserved for "empty" and must never be a real part: the tile grid is
 * a Uint16Array, and zero-initialised memory has to mean an empty cell.
 */
export const PARTS: readonly PartDef[] = [
  tile(1, "ground", "Ground", "terrain", Shape.FULL, SOLID, "#6b7f4a", "#8fae5f"),
  { ...tile(2, "hardBlock", "Hard block", "terrain", Shape.FULL, SOLID, "#7a6a58", "#9c8a74"), short: "Hard" },
  tile(
    3,
    "brickBlock",
    "Brick",
    "terrain",
    Shape.FULL,
    combine(TileFlags.SOLID, TileFlags.BREAKABLE, TileFlags.SCROLL_STOP),
    "#a4643a",
    "#c07a48",
  ),
  tile(
    4,
    "iceBlock",
    "Ice",
    "terrain",
    Shape.FULL,
    combine(TileFlags.SOLID, TileFlags.ICE),
    "#7fc7e8",
    "#a9dcf2",
  ),
  // Semisolids have no SHAPE: they are a surface, not a volume. Shape.FULL
  // here would make them block from the sides.
  tile(5, "semisolid", "Platform", "terrain", Shape.EMPTY, TileFlags.ONE_WAY, "#c08a4a"),
  tile(6, "slopeUpRight", "Slope /", "terrain", Shape.SLOPE_STEEP_R, SOLID, "#7d9455"),
  tile(7, "slopeUpLeft", "Slope \\", "terrain", Shape.SLOPE_STEEP_L, SOLID, "#7d9455"),
  tile(
    8,
    "spike",
    "Spikes",
    "hazard",
    Shape.FULL,
    combine(TileFlags.SOLID, TileFlags.HAZARD),
    "#8a8f9a",
    "#c9ced8",
  ),

  // 9 is the pipe body. Solid like a hard block; what makes it a pipe is the
  // mouth object placed on the end of it.
  tile(9, "pipe", "Pipe", "terrain", Shape.FULL, SOLID, "#2a9450", "#4fd47a"),

  object(100, "coin", "Coin", "item", "#ffd166"),
  { ...object(101, "growCap", "Power gem", "item", "#e05c4a"), short: "Gem" },
  // 102 is the extra life. Appended, never inserted: the numbers above belong to the
  // parts that already shipped with them.
  { ...object(102, "oneUp", "Extra life", "item", "#4fa35c"), short: "Life" },
  object(110, "walker", "Walker", "enemy", "#b1653a"),
  { ...object(111, "shellWalker", "Shell walker", "enemy", "#4fa35c"), short: "Shell" },

  /**
   * PIPE MOUTHS, PAIRED BY COLOUR.
   *
   * Place two of the same colour anywhere in a level and they lead to each
   * other. "The blue pipe goes to the other blue pipe" is a rule a
   * young player can hold in their head and reason about while building - and,
   * just as importantly, it needs no new field on the level document, so every
   * level anyone has already saved still loads unchanged. The ids are simply
   * appended, which is what the append-only contract is for.
   *
   * Which WAY a mouth faces is not stored: it is worked out at compile time
   * from where the pipe body sits next to it. See linkPipes.
   */
  // Labelled "warp", not "pipe". There is already a Pipe in the blocks row -
  // a solid green tile you build a pipe SHAPE out of - and having two different
  // things both called "pipe" meant placing the wrong one produced a pipe that
  // looked right and went nowhere, with nothing on screen to explain why.
  // The label is display-only; `key` is the stable contract and does not move.
  // No `short`: the chip wraps "Blue warp" onto two lines, so it says what the thing is.
  object(120, "pipeBlue", "Blue warp", "marker", "#4aa8ff"),
  object(121, "pipeOrange", "Orange warp", "marker", "#ff9e3d"),
  object(122, "pipePink", "Pink warp", "marker", "#ff7ad9"),
  object(123, "pipeWhite", "White warp", "marker", "#e8eef8"),
] as const;

/** Part ids of the pipe mouths, in palette order. */
export const PIPE_MOUTH_IDS: readonly number[] = [120, 121, 122, 123];

export function isPipeMouth(id: number): boolean {
  return PIPE_MOUTH_IDS.includes(id);
}

/** Empty cell. Never a real part; see the note above. */
export const PART_EMPTY: PartId = 0;

const BY_ID = new Map<PartId, PartDef>(PARTS.map((p) => [p.id, p]));
const BY_KEY = new Map<string, PartDef>(PARTS.map((p) => [p.key, p]));

export function partById(id: PartId): PartDef | undefined {
  return BY_ID.get(id);
}

export function partByKey(key: string): PartDef | undefined {
  return BY_KEY.get(key);
}

/** Parts a person can choose from, in palette order. */
export function palettableParts(): readonly PartDef[] {
  return PARTS.filter((p) => !p.retired);
}

export function tileParts(): readonly PartDef[] {
  return palettableParts().filter((p) => p.plane === "tile");
}

export function objectParts(): readonly PartDef[] {
  return palettableParts().filter((p) => p.plane === "object");
}
