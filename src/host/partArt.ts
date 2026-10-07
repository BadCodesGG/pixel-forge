import { isPipeMouth, partById } from "@/format/parts";
import { partArt } from "@/design/tokens";
import {
  drawBrick,
  drawCoin,
  drawGround,
  drawHardBlock,
  drawIce,
  drawGem,
  drawHeart,
  drawPipe,
  drawPipeMouth,
  drawPlatform,
  Open,
  drawShellWalker,
  drawSlope,
  drawSpikes,
  drawWalker,
} from "./sprites";

/**
 * Draw one part exactly as the world draws it, into an arbitrary canvas.
 *
 * This exists so the palette chip in the toolbar can be the REAL sprite rather
 * than a coloured square. "You place what you see" is the whole premise of a
 * level editor, and a swatch that only approximates the tile is a small lie a
 * young player has to learn to correct for.
 *
 * It lives in src/host rather than in the component because it is drawing code
 * and it shares the sprite library with the two renderers. The React side just
 * hands it a context.
 */
export function drawPartArt(
  ctx: CanvasRenderingContext2D,
  partId: number,
  x: number,
  y: number,
  size: number,
): void {
  const def = partById(partId);
  if (!def) {
    ctx.fillStyle = partArt(partId).base;
    ctx.fillRect(x, y, size, size);
    return;
  }

  // `exposed: true` so a tile shows its lit top edge in the palette - that edge
  // is most of what distinguishes ground from stone at chip size.
  const o = { exposed: true, size };

  switch (def.key) {
    case "ground":
      drawGround(ctx, x, y, o);
      return;
    case "brickBlock":
      drawBrick(ctx, x, y, o);
      return;
    case "hardBlock":
      drawHardBlock(ctx, x, y, o);
      return;
    case "iceBlock":
      drawIce(ctx, x, y, o);
      return;
    case "semisolid":
      drawPlatform(ctx, x, y, o);
      return;
    case "spike":
      drawSpikes(ctx, x, y, o);
      return;
    case "pipe":
      // Drawn as the END of a vertical run, so the palette chip shows the lip -
      // which is the part of a pipe you actually recognise.
      drawPipe(ctx, x, y, { exposed: true, size, open: Open.UP | Open.LEFT | Open.RIGHT });
      return;
    case "slopeUpRight":
      drawSlope(ctx, x, y, true, size);
      return;
    case "slopeUpLeft":
      drawSlope(ctx, x, y, false, size);
      return;
    case "coin":
      drawCoin(ctx, x, y, size, size, 0);
      return;
    case "growCap":
      drawGem(ctx, x, y, size, size);
      return;
    case "oneUp":
      drawHeart(ctx, x, y, size, size);
      return;
    case "walker":
      drawWalker(ctx, x, y, size, size, 1, 0);
      return;
    case "shellWalker":
      drawShellWalker(ctx, x, y, size, size, 1, 0);
      return;
    default:
      // Pipe mouths and anything else without bespoke art: the coloured ring.
      // For a mouth the colour is the whole point, so this is not a fallback so
      // much as the real thing.
      if (isPipeMouth(def.id)) {
        drawPipeMouth(ctx, x, y, size, partArt(def.id));
        return;
      }
      ctx.fillStyle = partArt(def.id).base;
      ctx.fillRect(x, y, size, size);
  }
}
