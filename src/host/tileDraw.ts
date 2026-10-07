import { TILE_PX } from "@/engine/math/fixed";
import { partById } from "@/format/parts";
import { partArt } from "@/design/tokens";
import {
  drawBrick,
  drawGround,
  drawHardBlock,
  drawIce,
  drawPipe,
  drawPlatform,
  drawSlope,
  drawSpikes,
} from "./sprites";

/**
 * THE SHARED TILE PAINTER.
 *
 * Both the game view and the editor view draw through this one function.
 *
 * That is a deliberate answer to a trap. The instinct is to say "the editor
 * renders through the real game renderer, so it can never look different", but
 * that claim does not survive contact with reality: the editor must zoom OUT
 * past the fixed play resolution, must show what is inside containers, and must
 * draw parts that are not currently spawned. So the editor keeps its OWN camera
 * and its own draw loop, and correctness comes from sharing the primitive that
 * decides what a tile LOOKS like, not from pretending one camera can serve both.
 */

export interface TileView {
  /** Part id at a cell, or 0 for empty. */
  partAt(tx: number, ty: number): number;
  readonly width: number;
  readonly height: number;
}

export interface TileCamera {
  /** World pixel at the top-left of the viewport. */
  x: number;
  y: number;
  /** Screen pixels per world pixel. 1 in play; variable in the editor. */
  zoom: number;
}

/** Grid-backed view over a compiled area or an editor document. */
export function gridView(parts: Uint16Array, width: number, height: number): TileView {
  return {
    width,
    height,
    partAt(tx, ty) {
      if (tx < 0 || tx >= width || ty < 0 || ty >= height) return 0;
      return parts[ty * width + tx];
    },
  };
}

/**
 * Paint every visible tile.
 *
 * `viewW`/`viewH` are in SCREEN pixels; the camera converts. Only the visible
 * window is walked, plus one tile of bleed so a partially-scrolled tile at the
 * edge is not clipped away.
 */
export function drawTiles(
  ctx: CanvasRenderingContext2D,
  view: TileView,
  camera: TileCamera,
  viewW: number,
  viewH: number,
): void {
  const size = TILE_PX * camera.zoom;
  const tx0 = Math.max(0, Math.floor(camera.x / TILE_PX) - 1);
  const ty0 = Math.max(0, Math.floor(camera.y / TILE_PX) - 1);
  const tx1 = Math.min(view.width - 1, Math.ceil((camera.x + viewW / camera.zoom) / TILE_PX));
  const ty1 = Math.min(view.height - 1, Math.ceil((camera.y + viewH / camera.zoom) / TILE_PX));

  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const partId = view.partAt(tx, ty);
      if (partId === 0) continue;
      const def = partById(partId);
      if (!def) continue;

      // Round to whole screen pixels. Sub-pixel destinations make the browser
      // antialias every tile edge, which on a tile grid reads as visible seams.
      const sx = Math.round((tx * TILE_PX - camera.x) * camera.zoom);
      const sy = Math.round((ty * TILE_PX - camera.y) * camera.zoom);
      const w = Math.round(size);

      const exposed = view.partAt(tx, ty - 1) === 0;
      // Hashed from the TILE's own grid coordinates, not from its position on
      // screen. The old version hashed the screen position, so every texture
      // detail crawled across the ground as the camera moved.
      const variant = (tx * 7 + ty * 13) % 4;

      // Which sides have no MATCHING tile beside them. Only the pipe reads this
      // today - it is how a run of pipe tiles works out which way it runs and
      // where its lip goes - but it costs four array reads and nothing else.
      const same = (ox: number, oy: number) => view.partAt(tx + ox, ty + oy) === partId;
      const open =
        (same(0, -1) ? 0 : 1) |
        (same(-1, 0) ? 0 : 2) |
        (same(1, 0) ? 0 : 4) |
        (same(0, 1) ? 0 : 8);

      // Below about 5 screen-pixels per tile, textured art turns to mud and
      // costs more than it conveys. A flat swatch of the SAME colour keeps the
      // zoomed-out view readable and identical in hue to the detailed version.
      //
      // The colour comes from PART_ART, not from `def.color`; the latter is
      // the original greybox palette and no longer matches anything the sprites
      // paint. See the note on PART_ART in src/design/tokens.ts.
      if (w < 5) {
        ctx.fillStyle = partArt(partId).base;
        ctx.fillRect(sx, sy, w, w);
        continue;
      }

      switch (def.key) {
        case "ground":
          drawGround(ctx, sx, sy, { exposed, size: w, variant, open });
          break;
        case "brickBlock":
          drawBrick(ctx, sx, sy, { exposed, size: w, variant, open });
          break;
        case "hardBlock":
          drawHardBlock(ctx, sx, sy, { exposed, size: w, variant, open });
          break;
        case "iceBlock":
          drawIce(ctx, sx, sy, { exposed, size: w, variant, open });
          break;
        case "semisolid":
          drawPlatform(ctx, sx, sy, { exposed, size: w, variant, open });
          break;
        case "spike":
          drawSpikes(ctx, sx, sy, { exposed, size: w, variant, open });
          break;
        case "pipe":
          drawPipe(ctx, sx, sy, { exposed, size: w, variant, open });
          break;
        case "slopeUpRight":
          drawSlope(ctx, sx, sy, true, w);
          break;
        case "slopeUpLeft":
          drawSlope(ctx, sx, sy, false, w);
          break;
        default:
          // An unknown part still has to appear, or a level from a newer build
          // renders as invisible holes the author cannot see or fix.
          ctx.fillStyle = partArt(partId).base;
          ctx.fillRect(sx, sy, w, w);
      }
    }
  }
}
