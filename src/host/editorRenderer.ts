import { TILE_PX } from "@/engine/math/fixed";
import { MARKER_GOAL, MARKER_START, cellPart } from "@/format/level";
import { partByKey, partById } from "@/format/parts";
import type { EditorDocument } from "@/editor/document";
import { EDITOR, SKY_BANDS, partArt } from "@/design/tokens";
import { LOGICAL_H } from "@/engine/core/constants";
import { drawTiles, type TileCamera, type TileView } from "./tileDraw";
import { drawPartArt } from "./partArt";
import {
  drawCoin,
  drawGoal,
  drawGem,
  drawShellWalker,
  drawStart,
  drawWalker,
} from "./sprites";

/**
 * THE EDIT VIEW.
 *
 * Draws the document with its OWN camera, which (unlike the play camera) can
 * zoom out past the play resolution and pan anywhere.
 *
 * That independence is not a compromise, it is a requirement. A level is 120
 * tiles wide and the play window shows 24 of them; an editor locked to the play
 * camera would leave a young player able to see 20% of what they built, with enemies
 * popping in and out as they pan. Sharing the tile PAINTER (see tileDraw.ts)
 * gives visual agreement; sharing the camera would give an unusable editor.
 */

/**
 * The editor's own chrome colours.
 *
 * These used to be a private block here, sharing nothing with the design
 * system, which is how the editor ended up looking like a different product
 * from the game it edits. They now live in src/design/tokens.ts alongside
 * everything else. The local alias is kept so the call sites below stay short.
 */
const COLORS = EDITOR;

export interface EditorOverlay {
  /** Tile under the pointer, or null when the pointer is outside. */
  cursorTx: number | null;
  cursorTy: number | null;
  /** Rectangle preview while dragging a fill. */
  rect: { tx0: number; ty0: number; tx1: number; ty1: number } | null;
  /** Palette part being placed, for the ghost preview. 0 = eraser. */
  activePart: number;
  showGrid: boolean;
  showMinimap: boolean;
}

export class EditorRenderer {
  private ctx: CanvasRenderingContext2D;
  width = 0;
  height = 0;

  /**
   * Screen space eaten by the floating chrome.
   *
   * The interface is docks floating OVER this canvas, so anything the canvas
   * draws near an edge -- principally the minimap -- has to keep out of their
   * way. A mutable field rather than a parameter on `minimapRect`, so neither
   * of the two `minimapToTile` call sites in Editor.tsx has to thread it
   * through; the component sets it once at boot from LAYOUT.
   */
  insets = { top: 0, right: 0, bottom: 0, left: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas2D is unavailable in this browser.");
    this.ctx = ctx;
  }

  /**
   * Match the backing store to the CSS size times the device pixel ratio.
   *
   * The editor is chrome, not pixel art: it is allowed a fractional device
   * ratio because nothing here needs to survive nearest-neighbour scaling.
   * The play view has the opposite requirement and gets integer scaling.
   */
  resize(cssW: number, cssH: number, dpr = 1): void {
    this.width = Math.max(1, Math.floor(cssW));
    this.height = Math.max(1, Math.floor(cssH));
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
  }

  draw(doc: EditorDocument, camera: TileCamera, overlay: EditorOverlay): void {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.outside;
    ctx.fillRect(0, 0, this.width, this.height);

    // The level's own extent, so the edges of the world are visible.
    //
    // The real sky goes behind it, not a flat dark board: a young player is building
    // IN the world, and an editor that paints the level onto a slate is a
    // document editor with tiles in it.
    const originX = Math.round(-camera.x * camera.zoom);
    const originY = Math.round(-camera.y * camera.zoom);
    const extentW = Math.round(doc.width * TILE_PX * camera.zoom);
    const extentH = Math.round(doc.height * TILE_PX * camera.zoom);
    this.drawExtentSky(originX, originY, extentW, extentH, camera.zoom);

    const view: TileView = {
      width: doc.width,
      height: doc.height,
      partAt: (tx, ty) => cellPart(doc.cellAt(tx, ty)),
    };
    drawTiles(ctx, view, camera, this.width, this.height);

    if (overlay.showGrid) this.drawGrid(doc, camera);
    this.drawObjects(doc, camera);
    this.drawFrame(originX, originY, extentW, extentH);
    this.drawRect(overlay, camera);
    this.drawCursor(doc, overlay, camera);
    if (overlay.showMinimap) this.drawMinimap(doc, camera);
  }

  /**
   * Hard sky bands behind the level.
   *
   * Anchored to the TOP of the level at their natural sizes so they match what
   * the play view paints, with the last band filling whatever is left. A level
   * can be far taller than one screen, so stretching the bands to the extent
   * would make the editor's sky a different sky from the game's.
   */
  private drawExtentSky(x: number, y: number, w: number, h: number, zoom: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    for (let i = 0; i < SKY_BANDS.length; i++) {
      const band = SKY_BANDS[i];
      const nextY = i + 1 < SKY_BANDS.length ? SKY_BANDS[i + 1].y : LOGICAL_H;
      const top = y + Math.round(band.y * zoom);
      const bottom = i + 1 < SKY_BANDS.length ? y + Math.round(nextY * zoom) : y + h;
      ctx.fillStyle = band.color;
      ctx.fillRect(x, top, w, Math.max(0, bottom - top));
    }
    ctx.restore();
  }

  /**
   * A bevelled frame around the level.
   *
   * Same vocabulary as every button: light on the top-left, dark on the
   * bottom-right, hard outline. It turns "the canvas" into a physical object
   * with an edge you can see the end of.
   */
  private drawFrame(x: number, y: number, w: number, h: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = EDITOR.frameLight;
    ctx.fillRect(x - 3, y - 3, w + 6, 3);
    ctx.fillRect(x - 3, y - 3, 3, h + 6);
    ctx.fillStyle = EDITOR.frameDark;
    ctx.fillRect(x - 3, y + h, w + 6, 3);
    ctx.fillRect(x + w, y - 3, 3, h + 6);
    ctx.strokeStyle = EDITOR.frameDark;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 3.5, y - 3.5, w + 7, h + 7);
  }

  private drawGrid(doc: EditorDocument, camera: TileCamera): void {
    const ctx = this.ctx;
    const size = TILE_PX * camera.zoom;
    // Below about 6 screen pixels per tile the grid is denser than it is
    // useful and turns the level into a grey haze.
    if (size < 6) return;

    const tx0 = Math.max(0, Math.floor(camera.x / TILE_PX));
    const ty0 = Math.max(0, Math.floor(camera.y / TILE_PX));
    const tx1 = Math.min(doc.width, Math.ceil((camera.x + this.width / camera.zoom) / TILE_PX));
    const ty1 = Math.min(doc.height, Math.ceil((camera.y + this.height / camera.zoom) / TILE_PX));

    // Clamped to the level's own extent so grid lines never extend into the
    // dead space around it; the boundary should stay obvious.
    const top = Math.round(-camera.y * camera.zoom);
    const bottom = Math.round((doc.height * TILE_PX - camera.y) * camera.zoom);
    const leftEdge = Math.round(-camera.x * camera.zoom);
    const rightEdge = Math.round((doc.width * TILE_PX - camera.x) * camera.zoom);

    // DOTS AT THE CORNERS, not continuous lines.
    //
    // A full grid of hairlines sits on top of the art like a spreadsheet and is
    // the single most "software" thing that was on this canvas. A dot at each
    // tile corner reads as a build grid you could snap to, and it disappears
    // behind the level instead of covering it.
    //
    // Also batched: one fillStyle assignment and N fillRects, rather than the
    // beginPath/stroke pair PER LINE this used to do, which was well over a
    // hundred path submissions every frame on a wide level.
    ctx.fillStyle = COLORS.grid;
    for (let ty = ty0; ty <= ty1; ty++) {
      const sy = Math.round((ty * TILE_PX - camera.y) * camera.zoom);
      if (sy < Math.max(0, top) || sy > Math.min(this.height, bottom)) continue;
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tx % 8 === 0 || ty % 8 === 0) continue;
        const sx = Math.round((tx * TILE_PX - camera.x) * camera.zoom);
        if (sx < Math.max(0, leftEdge) || sx > Math.min(this.width, rightEdge)) continue;
        ctx.fillRect(sx, sy, 1, 1);
      }
    }

    // Every 8th line stays continuous and brighter, so you can count tiles
    // without counting them.
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.gridMajor;
    ctx.beginPath();
    for (let tx = tx0; tx <= tx1; tx++) {
      if (tx % 8 !== 0) continue;
      const sx = Math.round((tx * TILE_PX - camera.x) * camera.zoom) + 0.5;
      ctx.moveTo(sx, Math.max(0, top));
      ctx.lineTo(sx, Math.min(this.height, bottom));
    }
    for (let ty = ty0; ty <= ty1; ty++) {
      if (ty % 8 !== 0) continue;
      const sy = Math.round((ty * TILE_PX - camera.y) * camera.zoom) + 0.5;
      ctx.moveTo(Math.max(0, leftEdge), sy);
      ctx.lineTo(Math.min(this.width, rightEdge), sy);
    }
    ctx.stroke();
  }

  /**
   * A whole-level strip along the bottom, with the viewport marked.
   *
   * The single most important navigation aid in this editor. A level is 120
   * tiles wide and the play window shows 24 of them, so without an overview a
   * young player is editing through a letterbox and loses track of what they built.
   * Click or drag it to jump anywhere instantly.
   */
  private drawMinimap(doc: EditorDocument, camera: TileCamera): void {
    const ctx = this.ctx;
    const rect = this.minimapRect(doc);
    if (!rect) return;

    // A plaque, in the same vocabulary as every other panel: hard outline,
    // light top-left, dark bottom-right. Sky behind it rather than near-black,
    // so the level's silhouette reads as terrain against a sky.
    ctx.fillStyle = EDITOR.frameDark;
    ctx.fillRect(rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6);
    ctx.fillStyle = EDITOR.frameLight;
    ctx.fillRect(rect.x - 2, rect.y - 2, rect.w + 4, 2);
    ctx.fillRect(rect.x - 2, rect.y - 2, 2, rect.h + 4);
    ctx.fillStyle = COLORS.minimapBack;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    // One pixel column per tile-ish. Sampling rather than drawing every tile
    // keeps this cheap even at full level size.
    const scaleX = rect.w / doc.width;
    const scaleY = rect.h / doc.height;
    for (let ty = 0; ty < doc.height; ty++) {
      for (let tx = 0; tx < doc.width; tx++) {
        const part = cellPart(doc.cellAt(tx, ty));
        if (part === 0) continue;
        const def = partById(part);
        if (!def) continue;
        ctx.fillStyle = partArt(def.id).base;
        ctx.fillRect(
          rect.x + tx * scaleX,
          rect.y + ty * scaleY,
          Math.max(1, scaleX),
          Math.max(1, scaleY),
        );
      }
    }

    // Objects as single bright dots, so enemies and coins are findable. The LIT
    // colour rather than the base, so an object pops against its own terrain.
    for (const obj of doc.allObjects()) {
      const def = partByKey(obj.part);
      ctx.fillStyle = def ? partArt(def.id).lit : COLORS.start;
      ctx.fillRect(rect.x + obj.tx * scaleX, rect.y + obj.ty * scaleY, 2, 2);
    }

    // The viewport rectangle: where you are, in the level.
    const viewX = rect.x + (camera.x / TILE_PX) * scaleX;
    const viewW = (this.width / camera.zoom / TILE_PX) * scaleX;
    const viewY = rect.y + (camera.y / TILE_PX) * scaleY;
    const viewH = (this.height / camera.zoom / TILE_PX) * scaleY;
    // Outlined in dark as well as gold, so the viewport box survives sitting on
    // top of a row of gold coins - which a single yellow hairline does not.
    const vx = Math.round(viewX) + 0.5;
    const vy = Math.round(Math.max(rect.y, viewY)) + 0.5;
    const vw = Math.round(Math.min(viewW, rect.w));
    const vh = Math.round(Math.min(viewH, rect.h));
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.minimapEdge;
    ctx.strokeRect(vx - 1, vy - 1, vw + 2, vh + 2);
    ctx.strokeStyle = COLORS.minimapView;
    ctx.strokeRect(vx, vy, vw, vh);
  }

  /** Screen rectangle the minimap occupies, or null if there is no room. */
  minimapRect(doc: EditorDocument): { x: number; y: number; w: number; h: number } | null {
    if (this.width < 320 || this.height < 220) return null;
    // Sits inside the safe area, so it is never hidden under a floating dock,
    // and never takes more than a third of the width. At 460px on a 1000px
    // screen it stopped reading as a navigation aid and started reading as a
    // panel dropped in the middle of the level.
    const available = this.width - this.insets.left - this.insets.right - 24;
    const w = Math.round(Math.min(Math.max(160, available), this.width / 3, 380));
    // Capped in height too: a tall level would otherwise give the strip the
    // proportions of a second viewport.
    const h = Math.max(24, Math.min(96, Math.round((w / doc.width) * doc.height)));
    return {
      x: this.insets.left + 12,
      y: this.height - this.insets.bottom - h - 12,
      w,
      h,
    };
  }

  /** Convert a click on the minimap into the tile it points at. */
  minimapToTile(
    doc: EditorDocument,
    screenX: number,
    screenY: number,
  ): { tx: number; ty: number } | null {
    const rect = this.minimapRect(doc);
    if (!rect) return null;
    if (
      screenX < rect.x ||
      screenX > rect.x + rect.w ||
      screenY < rect.y ||
      screenY > rect.y + rect.h
    ) {
      return null;
    }
    return {
      tx: Math.floor(((screenX - rect.x) / rect.w) * doc.width),
      ty: Math.floor(((screenY - rect.y) / rect.h) * doc.height),
    };
  }

  /**
   * Draw every object: markers, enemies, coins, power-ups.
   *
   * Anything placeable MUST be visible here. Handling only the two markers
   * meant a young player could drop four enemies into a level, see nothing at all,
   * and reasonably conclude the tool was broken: objects only appeared after
   * pressing play. Anything the editor can place, the editor has to show.
   */
  private drawObjects(doc: EditorDocument, camera: TileCamera): void {
    const ctx = this.ctx;
    const size = TILE_PX * camera.zoom;

    // How many objects have already been drawn in each cell, so a STACK is
    // fanned upward instead of every member landing on the same square.
    //
    // This is what makes stacking safe to allow at all: the old editor refused
    // to stack precisely because a hidden duplicate is impossible to notice and
    // impossible to remove. Drawn like this you can see the pile, count it, and
    // take it apart with the eraser one at a time.
    const drawn = new Map<number, number>();

    for (const obj of doc.allObjects()) {
      const cell = obj.ty * doc.width + obj.tx;
      const level = drawn.get(cell) ?? 0;
      drawn.set(cell, level + 1);

      const sx = (obj.tx * TILE_PX - camera.x) * camera.zoom;
      const sy = (obj.ty * TILE_PX - camera.y) * camera.zoom - level * size * 0.8;

      // Drawn with the SAME sprite functions the game uses. The editor showing
      // a different picture from play is a promise the tool quietly breaks:
      // you place what you see, so you must see what you place.
      if (obj.part === MARKER_START) {
        drawStart(ctx, sx, sy, size);
        continue;
      }
      if (obj.part === MARKER_GOAL) {
        drawGoal(ctx, sx, sy, size);
        continue;
      }

      const def = partByKey(obj.part);
      if (!def) {
        // An object from a newer build. Show something rather than nothing: an
        // invisible thing you cannot select or delete is worse than an
        // obviously-unknown one.
        ctx.fillStyle = COLORS.invalid;
        ctx.fillRect(sx + size * 0.2, sy + size * 0.2, size * 0.6, size * 0.6);
        continue;
      }

      // Too small for detail: a swatch in the right colour still tells you
      // something is there.
      if (size < 6) {
        ctx.fillStyle = partArt(def.id).base;
        ctx.fillRect(sx + size * 0.15, sy + size * 0.15, size * 0.7, size * 0.7);
        continue;
      }

      const inset = size * 0.08;
      const w = size - inset * 2;
      switch (def.key) {
        case "coin":
          drawCoin(ctx, sx + inset, sy + inset, w, w, 0);
          break;
        case "growCap":
          drawGem(ctx, sx + inset, sy + inset, w, w);
          break;
        case "walker":
          drawWalker(ctx, sx + inset, sy + inset, w, w, -1, 0);
          break;
        case "shellWalker":
          drawShellWalker(ctx, sx + inset, sy + inset, w, w, -1, 0);
          break;
        default:
          // Everything else - pipe mouths especially - goes through the shared
          // painter, so the editor never has to learn about a new object twice.
          drawPartArt(ctx, def.id, sx + inset, sy + inset, w);
      }
    }
  }

  private drawRect(overlay: EditorOverlay, camera: TileCamera): void {
    if (!overlay.rect) return;
    const ctx = this.ctx;
    const { tx0, ty0, tx1, ty1 } = normalizeRect(overlay.rect);
    const sx = (tx0 * TILE_PX - camera.x) * camera.zoom;
    const sy = (ty0 * TILE_PX - camera.y) * camera.zoom;
    const w = (tx1 - tx0 + 1) * TILE_PX * camera.zoom;
    const h = (ty1 - ty0 + 1) * TILE_PX * camera.zoom;
    ctx.fillStyle = COLORS.selection;
    ctx.fillRect(sx, sy, w, h);
    ctx.strokeStyle = COLORS.selectionEdge;
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, sy + 0.5, w - 1, h - 1);
  }

  private drawCursor(doc: EditorDocument, overlay: EditorOverlay, camera: TileCamera): void {
    const { cursorTx, cursorTy } = overlay;
    if (cursorTx === null || cursorTy === null) return;
    const ctx = this.ctx;
    const size = TILE_PX * camera.zoom;
    const sx = (cursorTx * TILE_PX - camera.x) * camera.zoom;
    const sy = (cursorTy * TILE_PX - camera.y) * camera.zoom;

    // Refusals must be visible. A cursor that simply does nothing outside the
    // level reads as a broken editor; a red box reads as "not there".
    if (!doc.inBounds(cursorTx, cursorTy)) {
      ctx.fillStyle = COLORS.invalid;
      ctx.fillRect(sx, sy, size, size);
      return;
    }

    const def = overlay.activePart ? partById(overlay.activePart) : undefined;

    if (def) {
      // THE GHOST IS THE REAL SPRITE.
      //
      // This used to paint a flat swatch of the part's colour. The entire
      // premise of a level editor is that you place what you see, and it was
      // broken at the exact moment the player is deciding what to place -- the
      // preview looked nothing like the thing that would land.
      ctx.globalAlpha = 0.55;
      drawPartArt(ctx, def.id, Math.round(sx), Math.round(sy), Math.round(size));
      ctx.globalAlpha = 1;
      ctx.strokeStyle = COLORS.cursor;
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 1, sy + 1, size - 2, size - 2);
      return;
    }

    // The eraser gets its own treatment. "This is going away" should not look
    // like "this is being placed".
    const hatch = this.eraseHatch();
    if (hatch) {
      const pattern = ctx.createPattern(hatch, "repeat");
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(sx, sy, size, size);
      }
    }
    ctx.strokeStyle = COLORS.selectionEdge;
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#ff5a5a";
    ctx.strokeRect(sx + 1, sy + 1, size - 2, size - 2);
  }

  /** Diagonal hatch for the eraser ghost. Built once, lazily. */
  private hatch: HTMLCanvasElement | null = null;

  private eraseHatch(): HTMLCanvasElement | null {
    if (this.hatch) return this.hatch;
    const c = document.createElement("canvas");
    c.width = 6;
    c.height = 6;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "rgba(255,90,90,0.30)";
    for (let i = 0; i < 6; i++) ctx.fillRect(i, (i + 3) % 6, 2, 1);
    this.hatch = c;
    return c;
  }
}

export function normalizeRect(rect: { tx0: number; ty0: number; tx1: number; ty1: number }) {
  return {
    tx0: Math.min(rect.tx0, rect.tx1),
    ty0: Math.min(rect.ty0, rect.ty1),
    tx1: Math.max(rect.tx0, rect.tx1),
    ty1: Math.max(rect.ty0, rect.ty1),
  };
}

export { COLORS as EDITOR_COLORS };
