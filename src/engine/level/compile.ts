import { fromTiles, type Fixed } from "../math/fixed";
import { TileFlags } from "../core/flags";
import { Tilemap } from "../collision/tilemap";
import { Shape } from "../collision/tileShapes";
import {
  MARKER_GOAL,
  MARKER_START,
  cellPart,
  type AreaDoc,
  type LevelDoc,
} from "@/format/level";
import { isPipeMouth, partByKey, partById } from "@/format/parts";

/**
 * COMPILE: authored document -> runtime world.
 *
 * A PURE function. Same document in, same compiled area out, every time, no
 * clock, no randomness, no I/O. That is what makes test-play instant (just
 * recompile and run) and what would let a level be verified outside the browser.
 *
 * The compiled form is deliberately dumb: flat typed arrays the collision code
 * can index without interpreting anything. All the meaning (which part is
 * solid, which is ice) is resolved HERE, once, rather than being looked up
 * per tile per frame.
 */

export interface CompiledArea {
  readonly map: Tilemap;
  /**
   * Part id per cell, parallel to the tilemap.
   *
   * The tilemap keeps only SHAPE and FLAGS, which is all collision needs, but
   * that deliberately throws away identity: ground and brick are both
   * solid-and-full, and a renderer working from the tilemap alone cannot tell
   * them apart. Keeping the part grid alongside means one grid answers
   * "what does this collide like" and the other "what does it look like",
   * without the renderer having to reverse-engineer the first into the second.
   */
  readonly parts: Uint16Array;
  readonly width: number;
  readonly height: number;
  readonly spawnX: Fixed;
  readonly spawnY: Fixed;
  readonly goalTx: number;
  readonly goalTy: number;
  /**
   * Everything that becomes an entity, sorted by x.
   *
   * Sorted because streaming walks it as the camera advances: with a sorted
   * table the spawner only has to consider a moving window, instead of
   * rescanning every object in the level on every frame.
   */
  readonly spawns: readonly SpawnRecord[];
  /** Warp pipes, already paired. Unpaired mouths are dropped, not linked. */
  readonly pipes: readonly PipeLink[];
  /** Parts referenced by the document that this build does not know about. */
  readonly unknownParts: readonly number[];
}

/**
 * Which way a pipe mouth opens.
 *
 * The direction the player travels to go IN. A mouth on top of a downward pipe
 * is entered by pressing DOWN, so its dir is "down".
 */
export type PipeDir = "up" | "down" | "left" | "right";

export interface PipeLink {
  /** Which coloured mouth this is, so the renderer can paint it. */
  readonly partId: number;
  readonly tx: number;
  readonly ty: number;
  /** Direction the player must press to enter. */
  readonly dir: PipeDir;
  /** Cell of the partner mouth. */
  readonly toTx: number;
  readonly toTy: number;
  /** Direction the player travels on the way OUT of the partner. */
  readonly exitDir: PipeDir;
}

export interface SpawnRecord {
  readonly partId: number;
  readonly tx: number;
  readonly ty: number;
  /**
   * Position within a stack of objects sharing this cell. 0 is the one on the
   * floor, 1 is standing on it, and so on.
   *
   * Stacking is a real thing an author does deliberately - a walker riding a
   * shell walker is a different obstacle from either alone - so the compiler
   * has to preserve the order rather than collapsing the cell to one object.
   * The spawner lifts each rider clear of the one below; see streamEntities.
   */
  readonly stack: number;
}

/**
 * Where the player starts if the level has no start marker.
 *
 * Test-play must NEVER be blocked by an incomplete level: the whole loop is
 * build a bit, try it, build more. A missing marker is a reason to warn, not a
 * reason to refuse to run.
 */
const FALLBACK_SPAWN_TX = 3;
const FALLBACK_SPAWN_TY = 3;

/** Part id of the pipe body tile. */
const PIPE_TILE = 9;

/**
 * Work out which way a mouth opens, from what is around it.
 *
 * The author never states a direction. They put a pipe end somewhere and the
 * direction falls out of what is next to it.
 *
 * TWO LEVELS OF EVIDENCE, and the order matters:
 *
 *   1. A PIPE BODY beside it. Unambiguous - the mouth caps that run, so it
 *      opens away from it.
 *
 *   2. Failing that, ANY SOLID GROUND beside it. This is the case that matters
 *      most, because it is what someone actually does first: drop two coloured
 *      ends on the floor and expect them to lead to each other. Requiring them
 *      to also build a pipe out of pipe blocks first is a rule you have to be
 *      told, and a rule you have to be told is a rule a young player will
 *      never discover. Ground underneath means you stand on it and press down.
 *
 * Only a mouth floating in empty space returns null, because there is genuinely
 * nothing to infer from.
 */
function mouthDir(parts: Uint16Array, w: number, h: number, tx: number, ty: number): PipeDir | null {
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : parts[y * w + x];

  if (at(tx, ty + 1) === PIPE_TILE) return "down";
  if (at(tx, ty - 1) === PIPE_TILE) return "up";
  if (at(tx - 1, ty) === PIPE_TILE) return "left";
  if (at(tx + 1, ty) === PIPE_TILE) return "right";

  // Anything solid will do. Below wins, because standing on a pipe end and
  // pressing down is the gesture everybody already knows.
  if (at(tx, ty + 1) !== 0) return "down";
  if (at(tx - 1, ty) !== 0) return "left";
  if (at(tx + 1, ty) !== 0) return "right";
  if (at(tx, ty - 1) !== 0) return "up";

  return null;
}

/**
 * Is this pipe tile the OPEN END of a run of pipe?
 *
 * This is what makes a plain green pipe a warp on its own. Requiring the author
 * to build a pipe and then drop a separate coloured marker on top of it is a
 * two-step assembly rule that has to be explained - and a rule that has to be
 * explained is one a young player will never work out. You build two pipes;
 * you should be able to travel between them.
 *
 * An END is a pipe tile with at most one pipe neighbour, whose opposite side is
 * open sky. The middle of a run has two neighbours and is not an end; the
 * buried bottom of a pipe has its open side in the ground and is not one
 * either. So a two-tile pipe standing on the floor yields exactly one mouth,
 * at the top, which is the only place you could climb in anyway.
 */
function isPipeEnd(parts: Uint16Array, w: number, h: number, tx: number, ty: number): boolean {
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? 0 : parts[y * w + x];
  const sides = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
  ];
  const joined = sides.filter((s) => at(tx + s.dx, ty + s.dy) === PIPE_TILE);
  if (joined.length > 1) return false;

  // A lone tile opens upward if there is sky above it.
  if (joined.length === 0) return at(tx, ty - 1) === 0;

  // Otherwise it opens directly away from whatever it is joined to.
  const away = joined[0];
  return at(tx - away.dx, ty - away.dy) === 0;
}

/** The way you come OUT of a pipe is the way it faces, i.e. back out the mouth. */
function opposite(dir: PipeDir): PipeDir {
  return dir === "down" ? "up" : dir === "up" ? "down" : dir === "left" ? "right" : "left";
}

/**
 * Pair up mouths of the same colour.
 *
 * Two of a colour make one two-way link. An odd one out is dropped rather than
 * linked to itself, and `validateLevel` says so in words - a pipe that silently
 * goes nowhere is the worst possible outcome for someone still learning what
 * they are building.
 */
function linkPipes(
  mouths: Map<number, { tx: number; ty: number }[]>,
  parts: Uint16Array,
  w: number,
  h: number,
): PipeLink[] {
  const links: PipeLink[] = [];

  for (const [partId, cells] of mouths) {
    if (cells.length < 2) continue;
    // Exactly the first two of a colour. A third is the author changing their
    // mind, and pairing it with one of the others would be a guess.
    const [a, b] = cells;
    const da = mouthDir(parts, w, h, a.tx, a.ty);
    const db = mouthDir(parts, w, h, b.tx, b.ty);
    if (!da || !db) continue;

    links.push({
      partId, tx: a.tx, ty: a.ty, dir: da, toTx: b.tx, toTy: b.ty, exitDir: opposite(db),
    });
    links.push({
      partId, tx: b.tx, ty: b.ty, dir: db, toTx: a.tx, toTy: a.ty, exitDir: opposite(da),
    });
  }

  return links;
}

export function compileArea(area: AreaDoc): CompiledArea {
  const map = new Tilemap(area.w, area.h);
  const parts = new Uint16Array(area.w * area.h);
  const unknown = new Set<number>();

  for (let ty = 0; ty < area.h; ty++) {
    for (let tx = 0; tx < area.w; tx++) {
      const cell = area.tiles[ty * area.w + tx] ?? 0;
      if (cell === 0) continue;

      const partId = cellPart(cell);
      const def = partById(partId);
      if (!def) {
        // A level from a newer build. Record it and leave the cell empty rather
        // than guessing: a wrong guess is worse than a hole, because the
        // author can see a hole.
        unknown.add(partId);
        continue;
      }
      map.set(tx, ty, def.shape, def.flags);
      parts[ty * area.w + tx] = partId;
    }
  }

  let spawnTx = FALLBACK_SPAWN_TX;
  let spawnTy = FALLBACK_SPAWN_TY;
  let goalTx = area.w - 4;
  let goalTy = FALLBACK_SPAWN_TY;
  const spawns: SpawnRecord[] = [];
  /** How many objects have already been placed in each cell. */
  const stackCount = new Map<number, number>();
  /** Pipe mouths gathered by colour, so same-coloured ones can be paired. */
  const mouths = new Map<number, { tx: number; ty: number }[]>();

  for (const obj of area.objects) {
    if (obj.part === MARKER_START) {
      spawnTx = obj.tx;
      spawnTy = obj.ty;
      continue;
    }
    if (obj.part === MARKER_GOAL) {
      goalTx = obj.tx;
      goalTy = obj.ty;
      continue;
    }
    const def = partByKey(obj.part);
    if (!def) {
      unknown.add(-1);
      continue;
    }
    // A pipe mouth is not an entity: it is a hole in the world. It gets paired
    // below rather than spawned.
    if (isPipeMouth(def.id)) {
      const list = mouths.get(def.id) ?? [];
      list.push({ tx: obj.tx, ty: obj.ty });
      mouths.set(def.id, list);
      continue;
    }

    if (def.plane === "object") {
      // Objects arrive in placement order, so the nth one in a cell is the nth
      // one the author stacked there.
      const stack = stackCount.get(obj.ty * area.w + obj.tx) ?? 0;
      stackCount.set(obj.ty * area.w + obj.tx, stack + 1);
      spawns.push({ partId: def.id, tx: obj.tx, ty: obj.ty, stack });
    }
  }

  // Sorted by cell for streaming, then by stack so a rider is always spawned
  // after the thing it is riding.
  spawns.sort((a, b) => a.tx - b.tx || a.ty - b.ty || a.stack - b.stack);

  /**
   * PLAIN PIPES ARE WARPS TOO.
   *
   * Every open end of a green pipe counts as a mouth, and they pair with each
   * other exactly like the coloured ones - green is simply a fifth colour that
   * you get by building a pipe rather than by choosing it from the palette.
   *
   * Scanned left-to-right so "the first two" means the two furthest left, which
   * is at least a rule you can see rather than one about click order.
   */
  const greenMouths: { tx: number; ty: number }[] = [];
  for (let ty = 0; ty < area.h; ty++) {
    for (let tx = 0; tx < area.w; tx++) {
      if (parts[ty * area.w + tx] !== PIPE_TILE) continue;
      if (isPipeEnd(parts, area.w, area.h, tx, ty)) greenMouths.push({ tx, ty });
    }
  }
  if (greenMouths.length > 0) mouths.set(PIPE_TILE, greenMouths);

  const pipes = linkPipes(mouths, parts, area.w, area.h);

  return {
    map,
    parts,
    width: area.w,
    height: area.h,
    // Spawn at the marker's tile centre horizontally, and sitting ON its tile
    // rather than inside it: a marker placed on the floor should not start the
    // player embedded in the ground.
    spawnX: (fromTiles(spawnTx) + fromTiles(1) / 2) as Fixed,
    spawnY: fromTiles(spawnTy),
    goalTx,
    goalTy,
    spawns,
    pipes,
    unknownParts: [...unknown],
  };
}

export function compileLevel(doc: LevelDoc): CompiledArea {
  return compileArea(doc.areas[0]);
}

/**
 * Problems worth telling the author about.
 *
 * These NEVER block test-play; they block publishing. A level you cannot try
 * is a level you cannot debug, and refusing to run an unfinished level is the
 * fastest way to make an editor unpleasant.
 */
export interface LevelIssue {
  readonly severity: "error" | "warning";
  readonly message: string;
}

export function validateLevel(doc: LevelDoc): LevelIssue[] {
  const issues: LevelIssue[] = [];
  const area = doc.areas[0];

  const hasStart = area.objects.some((o) => o.part === MARKER_START);
  const hasGoal = area.objects.some((o) => o.part === MARKER_GOAL);

  if (!hasStart) {
    issues.push({ severity: "warning", message: "No start flag, so you'll begin at the top left." });
  }
  if (!hasGoal) {
    issues.push({ severity: "error", message: "No finish flag, so this level can't be won yet." });
  }

  const solidCount = area.tiles.reduce((n, cell) => (cell === 0 ? n : n + 1), 0);
  if (solidCount === 0) {
    issues.push({ severity: "error", message: "This level is empty. Draw some ground first." });
  }

  const compiled = compileArea(area);

  /**
   * Pipes that go nowhere.
   *
   * Phrased as what to DO, like every other issue here. A pipe that silently
   * swallows you and does nothing is the worst outcome for someone still
   * working out what they are building, so it is worth saying out loud - but it
   * is a warning, not an error, because a half-built pipe is a normal stage of
   * building one and must never block test-play.
   */
  const mouthCounts = new Map<string, number>();
  for (const obj of area.objects) {
    const def = partByKey(obj.part);
    if (def && isPipeMouth(def.id)) {
      mouthCounts.set(obj.part, (mouthCounts.get(obj.part) ?? 0) + 1);
    }
  }
  for (const [part, count] of mouthCounts) {
    const label = partByKey(part)?.label ?? "pipe";
    if (count === 1) {
      issues.push({
        severity: "warning",
        message: `Only one ${label.toLowerCase()} - add a second one for it to lead to.`,
      });
    }
  }
  const linkedCells = new Set(compiled.pipes.map((p) => `${p.tx},${p.ty}`));
  const strandedMouths = area.objects.filter((o) => {
    const def = partByKey(o.part);
    if (!def || !isPipeMouth(def.id)) return false;
    return (mouthCounts.get(o.part) ?? 0) > 1 && !linkedCells.has(`${o.tx},${o.ty}`);
  });
  if (strandedMouths.length > 0) {
    issues.push({
      severity: "warning",
      message: "A pipe end is floating - put it on the ground or against a wall.",
    });
  }

  if (compiled.unknownParts.length > 0) {
    issues.push({
      severity: "warning",
      message: `${compiled.unknownParts.length} part(s) came from a newer version and can't be shown.`,
    });
  }

  return issues;
}

export { Shape, TileFlags };
