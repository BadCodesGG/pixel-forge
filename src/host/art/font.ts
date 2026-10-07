/**
 * THE IN-WORLD FONT.
 *
 * A 5x7 bitmap face, drawn as rectangles, stamped with a hard outline and a
 * hard drop shadow.
 *
 * WHY NOT ctx.fillText. The HUD used `ctx.font = "8px monospace"`, which is a
 * browser rendering a hinted, antialiased, system typeface into a 384x216
 * framebuffer that is then scaled up by a whole number. The result is fuzzy
 * grey text floating in front of a pixel-art scene - the single loudest "this
 * is a web page" signal left on the canvas, and the reason the brief says the
 * HUD has to belong to the world.
 *
 * WHY 5x7 AND NOT 3x5. 3x5 cannot make a legible digit at 1x on a phone; 5x7 is
 * the classic arcade cell and leaves room for a real 2 and a real S. With the
 * 1px outline the stamped box is 7x9, so a HUD line costs 9 of 216 rows.
 *
 * WHY EVERY LETTER, when only sixteen are needed today: authoring a partial set
 * guarantees that the next person to write a new word gets an invisible glyph
 * and no error. The whole alphabet is forty lines of data.
 */

export const GLYPH_W = 5;
export const GLYPH_H = 7;
/** Pen advance per character: the cell, its outline, and one pixel of tracking. */
export const ADVANCE = 7;

type Ctx = CanvasRenderingContext2D;

/** "#" is ink, "." is empty. Colour is applied when the stamp is rasterised. */
export const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..##.", "....#", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  J: ["....#", "....#", "....#", "....#", "#...#", "#...#", ".###."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".###.", "#...#", "#....", ".###.", "....#", "#...#", ".###."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ":": [".....", "..#..", "..#..", ".....", "..#..", "..#..", "....."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  "/": ["....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."],
};

/**
 * A finished stamp: shadow, outline and ink, rasterised once and reused.
 *
 * Naive per-draw outlining is eight dilation passes plus a shadow plus the ink,
 * for every character, every frame. Rasterising the finished thing once per
 * (character, colour, scale) turns a HUD line into a handful of drawImage
 * calls.
 *
 * The shadow is HARD - a solid one-pixel offset, no alpha and no blur. That is
 * what makes text sit ON a sky rather than float in front of one, and unlike
 * alpha it survives nearest-neighbour scaling intact.
 */
const stamps = new Map<string, HTMLCanvasElement>();

const OUTLINE_INK = "#0b0f1e";

function stamp(ch: string, ink: string, scale: number): HTMLCanvasElement | null {
  const rows = GLYPHS[ch];
  if (!rows) return null;

  const key = `${ch}|${ink}|${scale}`;
  const cached = stamps.get(key);
  if (cached) return cached;

  // The canvas is created HERE, inside the function. A document reference at
  // module scope breaks the production prerender and the Node test environment.
  const pad = 1;
  const w = (GLYPH_W + pad * 2) * scale;
  const h = (GLYPH_H + pad * 2 + 1) * scale;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;

  const px = (x: number, y: number, fill: string) => {
    ctx.fillStyle = fill;
    ctx.fillRect((x + pad) * scale, (y + pad) * scale, scale, scale);
  };

  // 1. Hard drop shadow, one pixel down-right of the outline.
  for (let y = 0; y < GLYPH_H; y++) {
    for (let x = 0; x < GLYPH_W; x++) {
      if (rows[y][x] === "#") px(x + 1, y + 2, OUTLINE_INK);
    }
  }
  // 2. Outline: the mask dilated in all eight directions.
  for (let y = 0; y < GLYPH_H; y++) {
    for (let x = 0; x < GLYPH_W; x++) {
      if (rows[y][x] !== "#") continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          px(x + dx, y + dy, OUTLINE_INK);
        }
      }
    }
  }
  // 3. The ink itself, on top.
  for (let y = 0; y < GLYPH_H; y++) {
    for (let x = 0; x < GLYPH_W; x++) {
      if (rows[y][x] === "#") px(x, y, ink);
    }
  }

  stamps.set(key, canvas);
  return canvas;
}

export interface TextOptions {
  ink?: string;
  /** Whole numbers only. 2 gives 10x14 characters. */
  scale?: number;
  align?: "left" | "center" | "right";
}

/** Width of a string in logical pixels, at a given scale. */
export function textWidth(text: string, scale = 1): number {
  return Math.max(0, text.length * ADVANCE - (ADVANCE - GLYPH_W)) * scale;
}

/**
 * Draw text at (x, y), where y is the TOP of the glyph cell.
 *
 * Coordinates are floored so a stamp never lands on a half pixel - the whole
 * point of a bitmap face is lost the moment it is drawn at a fraction.
 */
export function drawText(ctx: Ctx, text: string, x: number, y: number, o: TextOptions = {}): void {
  const scale = Math.max(1, Math.floor(o.scale ?? 1));
  const ink = o.ink ?? "#ffffff";
  const upper = text.toUpperCase();

  let penX = Math.floor(x);
  if (o.align === "center") penX = Math.floor(x - textWidth(upper, scale) / 2);
  else if (o.align === "right") penX = Math.floor(x - textWidth(upper, scale));
  const penY = Math.floor(y);

  for (const ch of upper) {
    const img = stamp(ch, ink, scale);
    // The stamp includes one pixel of padding on every side, so it is drawn one
    // pixel up and left of the cell it represents.
    if (img) ctx.drawImage(img, penX - scale, penY - scale);
    penX += ADVANCE * scale;
  }
}

/** Dev and HMR only. Nothing in production calls this. */
export function clearFontCache(): void {
  stamps.clear();
}
