import { LOGICAL_H, LOGICAL_W } from "@/engine/core/constants";
import { SKY_BANDS, WORLD } from "@/design/tokens";

/**
 * THE SKY.
 *
 * Replaces a two-stop linear gradient that was rebuilt every single frame.
 *
 * A gradient is a vector idiom: it makes a smooth ramp that no amount of
 * nearest-neighbour scaling turns into pixel art. Hard bands are what a console
 * game does, and they are also cheaper - the gradient allocated a CanvasGradient
 * object sixty times a second to produce the thing that made the scene look
 * least like a game.
 *
 * On top of the bands sit three scrolling layers at different rates. Parallax is
 * the cheapest possible signal that the world has depth, and without it running
 * right across a level feels like sliding a picture sideways.
 */

type Ctx = CanvasRenderingContext2D;

export interface ParallaxLayer {
  readonly id: string;
  /** Fraction of the camera's X. 0 is painted on the sky, 1 moves with the world. */
  readonly factorX: number;
  /** Fraction of the camera's Y, bounded by driftY. */
  readonly factorY: number;
  /** Cap on the vertical offset, so a tall level cannot slide the horizon away. */
  readonly driftY: number;
  /** Horizontal repeat period in logical pixels. The strip is this wide. */
  readonly period: number;
  /** Y of the strip's top in logical pixels, before drift. */
  readonly topY: number;
  readonly height: number;
  readonly paint: (ctx: Ctx) => void;
}

/** A stepped ridge: the pixel-art way to draw a hill. */
function ridge(
  ctx: Ctx,
  period: number,
  height: number,
  steps: readonly number[],
  body: string,
  lit: string,
): void {
  const stepW = period / steps.length;
  for (let i = 0; i < steps.length; i++) {
    const x = Math.round(i * stepW);
    const w = Math.round((i + 1) * stepW) - x;
    const top = height - steps[i];
    ctx.fillStyle = body;
    ctx.fillRect(x, top, w, steps[i]);
    // One lit row along the crest. The same trick every tile uses, so the
    // background reads as made of the same material as the ground.
    ctx.fillStyle = lit;
    ctx.fillRect(x, top, w, 1);
  }
}

function blob(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = WORLD.cloud;
  ctx.fillRect(x + 2, y, w - 4, h);
  ctx.fillRect(x, y + 2, w, h - 4);
  ctx.fillStyle = WORLD.cloudShade;
  ctx.fillRect(x + 2, y + h - 2, w - 4, 2);
}

export const SKY_LAYERS: readonly ParallaxLayer[] = [
  {
    id: "farHills",
    factorX: 0.2,
    factorY: 0.06,
    driftY: 12,
    period: 128,
    // Sat at 120 originally, which put the whole ridge BELOW the horizon of a
    // level with a high floor - the hills were drawn, then covered by the
    // ground, and all that showed was a two-pixel sliver that read as debris.
    // These are screen positions, not world ones, so they have to clear the
    // highest floor a level is likely to have.
    topY: 84,
    height: 48,
    paint: (ctx) =>
      ridge(ctx, 128, 48, [8, 16, 24, 34, 28, 18, 26, 14], WORLD.hillFar, WORLD.hillFarLit),
  },
  {
    id: "clouds",
    factorX: 0.35,
    factorY: 0.03,
    driftY: 8,
    period: 192,
    topY: 16,
    height: 44,
    paint: (ctx) => {
      blob(ctx, 8, 6, 34, 12);
      blob(ctx, 74, 22, 26, 10);
      blob(ctx, 128, 2, 44, 14);
    },
  },
  {
    id: "nearHills",
    factorX: 0.45,
    factorY: 0.1,
    driftY: 16,
    period: 160,
    topY: 104,
    height: 40,
    paint: (ctx) =>
      ridge(ctx, 160, 40, [14, 26, 34, 22, 30, 18], WORLD.hillNear, WORLD.hillNearLit),
  },
];

/**
 * Layer strips, rasterised once.
 *
 * Lazily, inside a function: nothing in this module may touch `document` at
 * module scope or the production prerender breaks.
 */
const strips = new Map<string, HTMLCanvasElement>();

function stripFor(layer: ParallaxLayer): HTMLCanvasElement | null {
  const cached = strips.get(layer.id);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = layer.period;
  canvas.height = layer.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  layer.paint(ctx);
  strips.set(layer.id, canvas);
  return canvas;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Paint the sky and its parallax layers.
 *
 * Roughly fourteen draw calls, all from cache, allocating nothing.
 */
export function drawSky(ctx: Ctx, camX: number, camY: number): void {
  for (let i = 0; i < SKY_BANDS.length; i++) {
    const band = SKY_BANDS[i];
    const next = i + 1 < SKY_BANDS.length ? SKY_BANDS[i + 1].y : LOGICAL_H;
    ctx.fillStyle = band.color;
    ctx.fillRect(0, band.y, LOGICAL_W, next - band.y);
  }

  for (const layer of SKY_LAYERS) {
    const strip = stripFor(layer);
    if (!strip) continue;

    // Floor BEFORE the modulo, so the offset is always a whole pixel and can
    // never jitter between frames. The double modulo keeps it non-negative for
    // a camera left of the origin.
    const raw = -Math.floor(camX * layer.factorX);
    const ox = ((raw % layer.period) + layer.period) % layer.period;
    // The drift cap matters: a level can be well over a hundred tiles tall, and
    // without it the hills slide entirely off screen exactly when the player is
    // highest up and most needs the horizon for orientation.
    const dy =
      layer.topY + clamp(-Math.floor(camY * layer.factorY), -layer.driftY, layer.driftY);

    for (let x = ox - layer.period; x < LOGICAL_W; x += layer.period) {
      ctx.drawImage(strip, x, dy);
    }
  }
}

/** Dev and HMR only. */
export function clearSkyCache(): void {
  strips.clear();
}
