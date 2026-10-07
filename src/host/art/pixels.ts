/**
 * THE SPRITE FORMAT.
 *
 * A sprite is a grid of characters, one per pixel, plus a palette mapping each
 * character to a colour. "." is transparent.
 *
 * ===========================================================================
 * WHY THIS RATHER THAN DRAWING COMMANDS
 * ===========================================================================
 * Every character used to be drawn with immediate-mode canvas calls at
 * FRACTIONAL coordinates -- `x + w * 0.08`, `top + h * 0.42` -- so that one
 * function could serve any size. That has two consequences that are fatal to
 * pixel art, and neither is fixable by rounding at the draw site:
 *
 *   1. EDGE CRAWL. Two independently-computed coordinates round in opposite
 *      directions depending on where the camera happens to be, so a band that
 *      should be 13px wide becomes 12 or 14 as the world scrolls. Interior
 *      details breathe by a pixel while you run. That is worse than blur,
 *      because it moves.
 *
 *   2. ANTIALIASING YOU CANNOT ROUND AWAY. The old coin was an `ellipse`, the
 *      walker a `quadraticCurveTo`, the brick a `stroke()`. Canvas2D
 *      antialiases all of those no matter what coordinates you hand them. You
 *      cannot round your way to a hard edge on an arc.
 *
 * A grid makes fractions structurally impossible: the rasteriser emits fillRect
 * with four integer arguments, and the draw site is a single drawImage at an
 * integer offset. There is nowhere for a fraction to enter.
 *
 * The other benefit is that the art becomes editable by a person. Adjusting a
 * character's eye is moving one letter in a picture you can read in the source.
 */

export type Palette = Readonly<Record<string, string>>;

export interface PixelSprite {
  /** Stable cache key. Must be unique across all sprites. */
  readonly id: string;
  readonly w: number;
  readonly h: number;
  /** Exactly `h` strings of exactly `w` characters. */
  readonly rows: readonly string[];
  readonly palette: Palette;
}

export interface PixelAnim {
  readonly id: string;
  readonly w: number;
  readonly h: number;
  readonly palette: Palette;
  readonly frames: readonly (readonly string[])[];
}

/**
 * Rasters, built on demand and kept forever.
 *
 * There is no invalidation and there should not be: the art is static data
 * compiled into the bundle, and the only thing that could change a raster is a
 * colour token, which changes at build time. A cache-invalidation scheme here
 * would be machinery guarding against an event that cannot happen.
 *
 * MAX_ENTRIES is a tripwire against a key-construction bug, not a memory
 * policy. Every entry regenerates lazily, so dropping the lot is safe.
 */
const rasters = new Map<string, HTMLCanvasElement>();
const MAX_ENTRIES = 512;

function paint(
  rows: readonly string[],
  palette: Palette,
  w: number,
  h: number,
  scale: number,
  flip: boolean,
): HTMLCanvasElement | null {
  // Created inside the function, never at module scope: a `document` reference
  // at module scope breaks the production prerender and the Node tests.
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;

  for (let y = 0; y < h; y++) {
    const row = rows[y];
    let x = 0;
    while (x < w) {
      const ch = row[x];
      if (ch === "." || ch === undefined) {
        x++;
        continue;
      }
      // Merge horizontal runs: a 16x16 tile drops from 256 fills to about 40.
      let end = x;
      while (end < w && row[end] === ch) end++;
      const colour = palette[ch];
      if (colour) {
        ctx.fillStyle = colour;
        const px = flip ? w - end : x;
        ctx.fillRect(px * scale, y * scale, (end - x) * scale, scale);
      }
      x = end;
    }
  }
  return canvas;
}

function cache(key: string, build: () => HTMLCanvasElement | null): HTMLCanvasElement | null {
  const hit = rasters.get(key);
  if (hit) return hit;
  if (rasters.size > MAX_ENTRIES) rasters.clear();
  const made = build();
  if (made) rasters.set(key, made);
  return made;
}

/**
 * A sprite at a whole-number scale, optionally mirrored.
 *
 * Mirroring is baked into the raster rather than done with ctx.scale(-1, 1) at
 * draw time: a negative transform flips about a fractional axis unless you are
 * very careful, forces a matrix change per sprite, and defeats this cache.
 */
export function spriteRaster(
  sprite: PixelSprite,
  scale: number,
  flip = false,
): HTMLCanvasElement | null {
  const s = Math.max(1, Math.floor(scale));
  return cache(`s:${sprite.id}:${s}:${flip ? 1 : 0}`, () =>
    paint(sprite.rows, sprite.palette, sprite.w, sprite.h, s, flip),
  );
}

/** One frame of an animation. `frame` is taken modulo the frame count. */
export function animRaster(
  anim: PixelAnim,
  frame: number,
  scale: number,
  flip = false,
): HTMLCanvasElement | null {
  const s = Math.max(1, Math.floor(scale));
  const i = ((frame % anim.frames.length) + anim.frames.length) % anim.frames.length;
  return cache(`a:${anim.id}:${i}:${s}:${flip ? 1 : 0}`, () =>
    paint(anim.frames[i], anim.palette, anim.w, anim.h, s, flip),
  );
}

/**
 * Choose the scale for a sprite asked to fill a box.
 *
 * Whole numbers only, and never zero. Below native size the caller should be
 * drawing a swatch instead; see the LOD branches in tileDraw.ts.
 */
export function scaleFor(boxW: number, nativeW: number): number {
  return Math.max(1, Math.round(boxW / nativeW));
}

/**
 * Blit a raster, centred in the box it was asked to fill.
 *
 * Both offsets are floored, because the entire point of this module is that
 * nothing ever lands on a half pixel.
 */
export function blit(
  ctx: CanvasRenderingContext2D,
  raster: HTMLCanvasElement,
  x: number,
  y: number,
  boxW: number,
  boxH: number,
): void {
  ctx.drawImage(
    raster,
    Math.floor(x + (boxW - raster.width) / 2),
    Math.floor(y + (boxH - raster.height) / 2),
  );
}

/** Dev and HMR only. Nothing in production calls this. */
export function clearSpriteCache(): void {
  rasters.clear();
}
