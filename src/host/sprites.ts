import { TILE_PX } from "@/engine/math/fixed";
import { WORLD } from "@/design/tokens";
import {
  COIN,
  HERO_BIG,
  HERO_SMALL,
  GEM,
  HEART,
  SHELL,
  SHELL_WALKER,
  WALKER,
} from "./art/actors";
import { animRaster, blit, scaleFor, spriteRaster, type PixelSprite } from "./art/pixels";

/**
 * THE ART.
 *
 * Two halves, drawn two different ways, for two different reasons.
 *
 * CHARACTERS AND ITEMS are pixel grids in ./art/actors.ts, rasterised once per
 * scale and blitted. They have curves, faces and outlines, and there is no way
 * to draw those with hard edges using canvas paths - see the note at the top of
 * ./art/pixels.ts.
 *
 * TILES are still drawn procedurally, but with `fillRect` ONLY and at whole
 * pixel coordinates. A tile is a small number of straight-edged bands, so a
 * grid would be more data than the drawing, and drawing them lets the editor
 * zoom to any tile size without a second set of art. Every path, every
 * `stroke()` and every fractional coordinate is gone: those were what made the
 * old tiles soft.
 *
 * THE FOUR RULES OF THE ART, unchanged:
 *   1. A dark outline on every character and item, so it reads against any tile.
 *   2. Eyes on everything alive. A face is what makes a shape a character.
 *   3. A lit top edge on every tile, so you can see what you can stand on.
 *   4. Silhouette over detail. It has to read at 16 pixels.
 */

type Ctx = CanvasRenderingContext2D;

/**
 * Which sides of a tile have nothing next to them.
 *
 * A bitmask rather than four booleans because it is computed once per tile per
 * frame in the innermost loop of the renderer, and because most tiles ignore it
 * entirely - only the pipe currently cares which way it runs.
 */
export const Open = {
  UP: 1,
  LEFT: 2,
  RIGHT: 4,
  DOWN: 8,
} as const;

export interface TileArtOptions {
  /** True when the tile above is empty, i.e. this is a walkable surface. */
  exposed: boolean;
  size: number;
  /** Bitmask of sides with no matching tile beside them. See `Open`. */
  open?: number;
  /**
   * Deterministic variation index for this tile.
   *
   * Derived from the tile's own grid coordinates by the caller. It used to be
   * hashed from the SCREEN position, which meant the ground's speckle crawled
   * across the world every time the camera moved - precisely the artefact the
   * old comment claimed it was avoiding.
   */
  variant?: number;
}

/** Whole-pixel geometry helper. Everything a tile draws goes through this. */
function rect(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

/** One "art pixel" at this tile size. Keeps details proportional when zoomed. */
function unit(size: number): number {
  return Math.max(1, Math.round(size / 16));
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

/** Grass-capped earth. The default ground everyone builds with. */
export function drawGround(ctx: Ctx, x: number, y: number, o: TileArtOptions): void {
  const s = Math.round(o.size);
  const u = unit(s);
  rect(ctx, x, y, s, s, WORLD.earth);

  // Speckle, positioned from the TILE's variant rather than its screen
  // position, so the texture stays put while the world scrolls.
  const v = o.variant ?? 0;
  rect(ctx, x + u * (2 + (v % 3) * 3), y + s * 0.5, u * 2, u * 2, WORLD.earthDark);
  rect(ctx, x + u * (9 - (v % 2) * 4), y + s * 0.72, u, u, WORLD.earthDark);

  // A shadow down the left edge, but ONLY where the ground actually ends.
  //
  // Drawn on every tile it turned a run of ground into a row of fence posts:
  // at 16px the repeated dark column reads as vertical planks, not soil. On the
  // exposed edge of a platform it does what it was meant to do.
  if ((o.open ?? 0) & Open.LEFT) rect(ctx, x, y, u, s, WORLD.earthDark);

  if (o.exposed) {
    const cap = u * 4;
    rect(ctx, x, y, s, cap, WORLD.grassTop);
    rect(ctx, x, y, s, u, WORLD.grassTopLit);
    // A ragged tooth line where the cap meets the earth, so the join is not a
    // ruled edge.
    for (let i = 0; i < 4; i++) {
      if ((v + i) % 2 === 0) rect(ctx, x + i * u * 4, y + cap, u * 2, u, WORLD.grassTop);
    }
  }
}

/** Brick: running bond, one lit row per course. */
export function drawBrick(ctx: Ctx, x: number, y: number, o: TileArtOptions): void {
  const s = Math.round(o.size);
  const u = unit(s);
  rect(ctx, x, y, s, s, WORLD.brick);

  const course = s / 3;
  for (let r = 0; r < 3; r++) {
    const top = y + r * course;
    rect(ctx, x, top, s, u, WORLD.brickLit);
    rect(ctx, x, top + course - u, s, u, WORLD.brickDark);
    // Offset the vertical joint every other course. That offset is the whole
    // difference between "bricks" and "a grid".
    const joint = r % 2 === 0 ? s / 2 : 0;
    rect(ctx, x + joint, top, u, course, WORLD.brickDark);
    if (r % 2 === 1) rect(ctx, x + s - u, top, u, course, WORLD.brickDark);
  }
}

/** Hard block: bevelled with corner rivets, so it reads as "you can't break this". */
export function drawHardBlock(ctx: Ctx, x: number, y: number, o: TileArtOptions): void {
  const s = Math.round(o.size);
  const u = unit(s);
  rect(ctx, x, y, s, s, WORLD.stone);
  rect(ctx, x, y, s, u, WORLD.stoneLit);
  rect(ctx, x, y, u, s, WORLD.stoneLit);
  rect(ctx, x, y + s - u * 2, s, u * 2, WORLD.stoneDark);
  rect(ctx, x + s - u * 2, y, u * 2, s, WORLD.stoneDark);
  const r = u * 2;
  rect(ctx, x + u * 2, y + u * 2, r, r, WORLD.stoneDark);
  rect(ctx, x + s - u * 4, y + u * 2, r, r, WORLD.stoneDark);
  rect(ctx, x + u * 2, y + s - u * 4, r, r, WORLD.stoneDark);
  rect(ctx, x + s - u * 4, y + s - u * 4, r, r, WORLD.stoneDark);
}

/** Ice: pale, with a stepped glint and a dithered interior. */
export function drawIce(ctx: Ctx, x: number, y: number, o: TileArtOptions): void {
  const s = Math.round(o.size);
  const u = unit(s);
  rect(ctx, x, y, s, s, WORLD.ice);

  // A 2px checkerboard rather than an alpha wash. Dithering is how a console
  // game says "translucent"; globalAlpha would be a smooth veil.
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 8; gx++) {
      if ((gx + gy) % 2 !== 0) continue;
      rect(ctx, x + gx * u * 2, y + gy * u * 2, u * 2, u * 2, WORLD.iceLit);
    }
  }
  // A stepped staircase glint, not a filled parallelogram.
  for (let i = 0; i < 4; i++) {
    rect(ctx, x + u * (3 + i * 2), y + s - u * (5 + i * 2), u * 2, u * 2, "#ffffff");
  }
  rect(ctx, x, y, s, u, "#ffffff");
  rect(ctx, x, y + s - u * 2, s, u * 2, WORLD.iceDark);
}

/** Semisolid: a wooden plank lip. Thin on purpose - you can pass through it. */
export function drawPlatform(ctx: Ctx, x: number, y: number, o: TileArtOptions): void {
  const s = Math.round(o.size);
  const u = unit(s);
  const h = u * 5;
  rect(ctx, x, y, s, h, WORLD.wood);
  rect(ctx, x, y, s, u, WORLD.woodLit);
  rect(ctx, x, y + h - u, s, u, WORLD.woodDark);
  rect(ctx, x + s / 2 - u, y, u, h, WORLD.woodDark);
  // Two short support pegs hanging below, so "you can drop through this" is
  // legible from the silhouette alone.
  rect(ctx, x + u * 3, y + h, u * 2, u * 2, WORLD.woodDark);
  rect(ctx, x + s - u * 5, y + h, u * 2, u * 2, WORLD.woodDark);
}

/** Spikes: stepped triangles with lit faces, so the danger points at you. */
export function drawSpikes(ctx: Ctx, x: number, y: number, o: TileArtOptions): void {
  const s = Math.round(o.size);
  const u = unit(s);
  rect(ctx, x, y + s - u * 4, s, u * 4, WORLD.spikeDark);
  rect(ctx, x, y + s - u * 4, s, u, WORLD.spike);

  // Three staircases rather than three filled paths. A path is antialiased; a
  // staircase of rectangles is what a spike actually looks like in pixel art.
  for (let i = 0; i < 3; i++) {
    const cx = x + u * (2 + i * 5);
    for (let step = 0; step < 5; step++) {
      const w = u * (5 - step);
      const sx = cx + (u * step) / 2;
      rect(ctx, sx, y + s - u * (4 + step + 1), w, u, WORLD.spike);
      rect(ctx, sx, y + s - u * (4 + step + 1), u, u, WORLD.spikeLit);
    }
  }
}

/**
 * A pipe segment.
 *
 * Which way it runs is read from its neighbours rather than stored: a length of
 * pipe with nothing to its left or right is a vertical one, and the END of a
 * run gets the wide lip. That means an author draws a pipe the obvious way -
 * a line of pipe tiles - and it comes out looking like a pipe, with no
 * orientation to choose and get wrong.
 */
export function drawPipe(ctx: Ctx, x: number, y: number, o: TileArtOptions): void {
  const s = Math.round(o.size);
  const u = unit(s);
  const open = o.open ?? 0;

  // Nothing beside it means the run goes up and down.
  const vertical = (open & Open.LEFT) !== 0 && (open & Open.RIGHT) !== 0;

  rect(ctx, x, y, s, s, WORLD.shellDark);

  if (vertical) {
    rect(ctx, x + u * 2, y, s - u * 4, s, WORLD.shell);
    rect(ctx, x + u * 3, y, u * 2, s, WORLD.shellLit);
    rect(ctx, x + s - u * 4, y, u * 2, s, WORLD.shellDark);
    // The lip, at whichever end is the mouth.
    if (open & Open.UP) {
      rect(ctx, x - u, y, s + u * 2, u * 5, WORLD.shell);
      rect(ctx, x - u, y, s + u * 2, u, WORLD.shellLit);
      rect(ctx, x - u, y + u * 4, s + u * 2, u, WORLD.shellDark);
    }
    if (open & Open.DOWN) {
      rect(ctx, x - u, y + s - u * 5, s + u * 2, u * 5, WORLD.shell);
      rect(ctx, x - u, y + s - u * 5, s + u * 2, u, WORLD.shellLit);
      rect(ctx, x - u, y + s - u, s + u * 2, u, WORLD.shellDark);
    }
    return;
  }

  rect(ctx, x, y + u * 2, s, s - u * 4, WORLD.shell);
  rect(ctx, x, y + u * 3, s, u * 2, WORLD.shellLit);
  rect(ctx, x, y + s - u * 4, s, u * 2, WORLD.shellDark);
  if (open & Open.LEFT) {
    rect(ctx, x, y - u, u * 5, s + u * 2, WORLD.shell);
    rect(ctx, x, y - u, u, s + u * 2, WORLD.shellLit);
    rect(ctx, x + u * 4, y - u, u, s + u * 2, WORLD.shellDark);
  }
  if (open & Open.RIGHT) {
    rect(ctx, x + s - u * 5, y - u, u * 5, s + u * 2, WORLD.shell);
    rect(ctx, x + s - u * 5, y - u, u, s + u * 2, WORLD.shellLit);
    rect(ctx, x + s - u, y - u, u, s + u * 2, WORLD.shellDark);
  }
}

/**
 * A pipe END, drawn in its pairing colour.
 *
 * This is a whole pipe mouth - lip, body and a dark opening - not a marker
 * sitting on top of one. Dropping two of these on the ground has to LOOK like
 * two pipes, because that is all anybody is going to do: the version that drew
 * a small coloured square relied on the author also building a pipe out of pipe
 * blocks, which is a rule you can only learn by being told.
 *
 * The whole thing takes the pairing colour rather than being green with a
 * coloured dot, so "the blue pipe goes to the other blue pipe" is legible from
 * across the room.
 */
export function drawPipeMouth(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  art: { base: string; lit: string; dark: string },
): void {
  const s = Math.round(size);
  const u = unit(s);

  // A GREEN pipe with a coloured lip, not a solid block of colour.
  //
  // A pipe is green - that is what a pipe looks like, and a person who has
  // built two green pipes and wants to travel between them should recognise
  // this instantly as the same object. The pairing colour rides on the LIP,
  // where it is the most visible part and cannot be mistaken for the pipe
  // itself.
  rect(ctx, x + u * 2, y + u * 5, s - u * 4, s - u * 5, WORLD.shell);
  rect(ctx, x + u * 3, y + u * 5, u * 2, s - u * 5, WORLD.shellLit);
  rect(ctx, x + s - u * 4, y + u * 5, u * 2, s - u * 5, WORLD.shellDark);

  // The lip, wider than the body, in the pairing colour.
  rect(ctx, x, y, s, u * 5, art.base);
  rect(ctx, x, y, s, u, art.lit);
  rect(ctx, x, y + u * 4, s, u, art.dark);

  // The opening. Dark, because it is a hole you can go down.
  rect(ctx, x + u * 3, y + u, s - u * 6, u * 3, WORLD.outline);
}

/** A sloped surface with a grass cap that follows the incline. */
export function drawSlope(ctx: Ctx, x: number, y: number, risesRight: boolean, size: number): void {
  const s = Math.round(size);
  const u = unit(s);
  const steps = Math.max(4, Math.round(s / u / 2));
  const stepW = s / steps;

  for (let i = 0; i < steps; i++) {
    const col = risesRight ? i : steps - 1 - i;
    const height = Math.round(((i + 1) / steps) * s);
    const sx = x + col * stepW;
    rect(ctx, sx, y + s - height, stepW, height, WORLD.earth);
    rect(ctx, sx, y + s - height, stepW, u * 3, WORLD.grassTop);
    rect(ctx, sx, y + s - height, stepW, u, WORLD.grassTopLit);
  }
}

// ---------------------------------------------------------------------------
// Characters and items
// ---------------------------------------------------------------------------

function put(
  ctx: Ctx,
  sprite: PixelSprite,
  x: number,
  y: number,
  w: number,
  h: number,
  flip = false,
): void {
  const raster = spriteRaster(sprite, scaleFor(w, sprite.w), flip);
  if (raster) blit(ctx, raster, x, y, w, h);
}

/**
 * The hero.
 *
 * The pose is chosen from what he is actually doing, rather than a one-pixel
 * bob standing in for all of it:
 *
 *   airborne          -> tucked legs and a raised arm
 *   turning while fast -> braced backwards, with dust
 *   running           -> a two-frame stride
 *   otherwise         -> standing
 *
 * Big and small are different grids, not one grid at two sizes, so being big
 * makes him TALLER rather than merely larger - which is what the collision box
 * actually does.
 */
export function drawHero(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  facing: -1 | 1,
  moving: boolean,
  grounded: boolean,
  frame: number,
  vx = 0,
): void {
  // Chosen from the height the sim asked for, so no call site needs a new
  // argument to say which one it wants.
  const set = h >= 27 ? HERO_BIG : HERO_SMALL;

  let pose = set.idle;
  if (!grounded) pose = set.jump;
  else if (moving && vx !== 0 && Math.sign(vx) !== facing) pose = set.skid;
  else if (moving) pose = Math.floor(frame / 6) % 2 === 0 ? set.walkA : set.walkB;

  put(ctx, pose, x, y, w, h, facing === -1);
}

/** The walker. Facing is real: the raster is mirrored, eyes and all. */
export function drawWalker(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  facing: -1 | 1,
  frame: number,
): void {
  const raster = animRaster(WALKER, Math.floor(frame / 8), scaleFor(w, WALKER.w), facing === -1);
  if (raster) blit(ctx, raster, x, y, w, h);
}

export function drawShellWalker(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  facing: -1 | 1,
  frame: number,
): void {
  const raster = animRaster(
    SHELL_WALKER,
    Math.floor(frame / 8),
    scaleFor(w, SHELL_WALKER.w),
    facing === -1,
  );
  if (raster) blit(ctx, raster, x, y, w, h);
}

/** A loose shell. The idle wobble is what distinguishes a live one from scenery. */
export function drawShell(ctx: Ctx, x: number, y: number, w: number, h: number, frame = 0): void {
  const raster = animRaster(SHELL, Math.floor(frame / 12), scaleFor(w, SHELL.w));
  if (raster) blit(ctx, raster, x, y, w, h);
}

export function drawCoin(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  frame: number,
): void {
  const raster = animRaster(COIN, Math.floor(frame / 7), scaleFor(w, COIN.w));
  if (raster) blit(ctx, raster, x, y, w, h);
}

/** Power gem. */
export function drawGem(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  put(ctx, GEM, x, y, w, h);
}

/** Extra life. A heart, never the gem shape, so it reads as a different thing. */
export function drawHeart(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  put(ctx, HEART, x, y, w, h);
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/** The finish: a tall pole with a chequered flag. */
export function drawGoal(ctx: Ctx, x: number, y: number, size = TILE_PX): void {
  const s = Math.round(size);
  const u = unit(s);
  const poleH = s * 4;
  const top = y - poleH + s;

  rect(ctx, x + u * 7, top, u * 2, poleH, WORLD.stone);
  rect(ctx, x + u * 7, top, u, poleH, WORLD.stoneLit);
  rect(ctx, x + u * 5, top - u * 2, u * 6, u * 2, WORLD.coin);
  rect(ctx, x + u * 4, y + s - u * 2, u * 8, u * 2, WORLD.stoneDark);

  // Hard 4px chequers, not a loop of half-cells.
  const cell = u * 4;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const fill = (r + c) % 2 === 0 ? "#ffffff" : WORLD.outline;
      rect(ctx, x + u * 9 + c * cell, top + u * 2 + r * cell, cell, cell, fill);
    }
  }
}

/** The start: a green pennant on a short pole. */
export function drawStart(ctx: Ctx, x: number, y: number, size = TILE_PX): void {
  const s = Math.round(size);
  const u = unit(s);
  const top = y - s;

  rect(ctx, x + u * 3, top, u * 2, s * 2, WORLD.stone);
  rect(ctx, x + u * 3, top, u, s * 2, WORLD.stoneLit);
  rect(ctx, x + u * 2, y + s - u * 2, u * 6, u * 2, WORLD.stoneDark);

  // A stepped pennant. Each step is a whole art pixel tall.
  for (let i = 0; i < 5; i++) {
    rect(ctx, x + u * 5, top + u * (1 + i), u * (9 - i), u, WORLD.shell);
  }
  rect(ctx, x + u * 5, top + u, u * 9, u, WORLD.shellLit);
}
