import { toPxFloat, TILE_PX, type Fixed } from "@/engine/math/fixed";
import { LOGICAL_H, LOGICAL_W } from "@/engine/core/constants";
import type { Sim } from "@/engine/sim";
import { DEATH_FRAMES, EntityState, SHELL_PART, anyDefFor } from "@/engine/entities/defs";
import { WORLD, partArt } from "@/design/tokens";
import { drawSky } from "./art/parallax";
import { drawText, textWidth } from "./art/font";
import { drawTiles, gridView } from "./tileDraw";
import {
  drawCoin,
  drawGoal,
  drawHero,
  drawGem,
  drawHeart,
  drawPipeMouth,
  drawShell,
  drawShellWalker,
  drawWalker,
} from "./sprites";

/**
 * THE PLAY VIEW.
 *
 * Draws untextured shapes colour-coded by part, which is what you want before
 * art exists: you see the collision geometry the physics is actually using,
 * rather than a sprite that might be lying about it.
 *
 * ---------------------------------------------------------------------------
 * PIXEL-CRISP SCALING
 * ---------------------------------------------------------------------------
 * The backing store is LOGICAL_W x LOGICAL_H times an INTEGER scale, never a
 * fractional one: scaling pixel art by 2.5 makes some pixels two screen-pixels
 * wide and others three, and no CSS property can fix that.
 *
 * The camera is snapped to whole pixels too. Drawing the tilemap at a sub-pixel
 * offset while snapping sprites makes every ground-standing object visibly
 * vibrate against the ground: the classic pixel-art rendering mistake.
 */

/** Part id of the plain green pipe tile. See drawMarkers. */
const PIPE_TILE_ID = 9;

const COLORS = {
  hitbox: "rgba(255,255,0,0.85)",
  plaque: "#1b2338",
  plaqueInk: "#070b16",
  plaqueLit: "#4a5a86",
  plaqueShade: "#0e1426",
} as const;

/**
 * The hero's head, 9x9, as the lives icon.
 *
 * A tiny portrait rather than a heart or the word LIVES: the thing you have
 * three of is HIM, and a young player reads a face faster than either.
 */
function drawHeadPip(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = "#0b0f1e";
  ctx.fillRect(x - 1, y - 1, 11, 11);
  ctx.fillStyle = WORLD.hero;
  ctx.fillRect(x, y, 9, 3);
  ctx.fillStyle = WORLD.heroSkin;
  ctx.fillRect(x + 1, y + 3, 7, 5);
  ctx.fillStyle = WORLD.outline;
  ctx.fillRect(x + 2, y + 4, 2, 2);
  ctx.fillRect(x + 6, y + 4, 2, 2);
  ctx.fillStyle = WORLD.hero;
  ctx.fillRect(x + 6, y + 2, 3, 2);
}

/** A 9x9 coin for the HUD, outline baked in so it reads over any tile. */
function drawCoinPip(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.fillStyle = "#0b0f1e";
  ctx.fillRect(x + 1, y, 7, 9);
  ctx.fillRect(x, y + 1, 9, 7);
  ctx.fillStyle = WORLD.coinDark;
  ctx.fillRect(x + 2, y + 1, 5, 7);
  ctx.fillRect(x + 1, y + 2, 7, 5);
  ctx.fillStyle = WORLD.coin;
  ctx.fillRect(x + 3, y + 2, 3, 5);
  ctx.fillRect(x + 2, y + 3, 5, 3);
  ctx.fillStyle = WORLD.coinLit;
  ctx.fillRect(x + 3, y + 3, 1, 2);
}

/** A 9x8 gem. Lit when the player is big, a silhouette when small. */
function drawGemPip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  big: boolean,
): void {
  const body = big ? WORLD.gem : "#3a4258";
  const lit = big ? WORLD.gemSpark : "#4c556e";
  const dark = big ? WORLD.gemDark : "#3a4258";
  ctx.fillStyle = "#0b0f1e";
  ctx.fillRect(x - 1, y - 1, 11, 10);
  ctx.fillStyle = body;
  ctx.fillRect(x + 2, y, 5, 1);
  ctx.fillRect(x, y + 1, 9, 2);
  ctx.fillRect(x + 1, y + 3, 7, 1);
  ctx.fillRect(x + 2, y + 4, 5, 1);
  ctx.fillRect(x + 3, y + 5, 3, 1);
  ctx.fillRect(x + 4, y + 6, 1, 1);
  ctx.fillStyle = dark;
  ctx.fillRect(x + 6, y + 2, 3, 1);
  ctx.fillRect(x + 5, y + 3, 3, 1);
  ctx.fillRect(x + 5, y + 4, 2, 1);
  ctx.fillStyle = lit;
  ctx.fillRect(x + 2, y + 1, 2, 1);
  ctx.fillRect(x + 1, y + 2, 1, 1);
}

/**
 * A 2x2 checkerboard, for dimming the screen without alpha.
 *
 * Built lazily inside a function - nothing in this module may touch `document`
 * at module scope, or the production prerender breaks.
 */
function makeDither(): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 2;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#070b16";
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillRect(1, 1, 1, 1);
  return c;
}

export interface RenderOptions {
  showHitboxes: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  text?: string;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  scale = 1;

  /**
   * Decorative effects, owned entirely by the renderer.
   *
   * These live here rather than in the simulation because nothing about a
   * sparkle can change the outcome of a run. Putting them in the sim would make
   * every visual tweak a determinism change that invalidates stored replays.
   */
  private particles: Particle[] = [];

  /**
   * How long the level has been cleared, in drawn frames.
   *
   * Host-side, not sim-side: it drives an animation and can never change the
   * outcome of a run, so putting it in the sim would make every tweak to the
   * win screen a determinism change that invalidates stored replays.
   */
  private clearedFrames = 0;
  private dither: HTMLCanvasElement | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas2D is unavailable in this browser.");
    this.ctx = ctx;
  }

  /**
   * Forget the effects of the previous run. Called whenever a new simulation is
   * attached, so sparks and the win animation from one level never carry into
   * the next.
   */
  reset(): void {
    this.particles = [];
    this.clearedFrames = 0;
  }

  /** The number of live particles, for tests. */
  get particleCount(): number {
    return this.particles.length;
  }

  /** Turn this tick's simulation events into visual effects. */
  consumeEvents(sim: Sim): void {
    for (const event of sim.events) {
      const x = toPxFloat(event.x);
      const y = toPxFloat(event.y);
      // Colours come from the world palette, so retuning the palette moves the
      // sparkles with it rather than leaving them behind at the old hues.
      switch (event.kind) {
        case "coin":
          this.burst(x, y, 6, WORLD.coin);
          this.popup(x, y, "+100", WORLD.coinLit);
          break;
        case "stomp":
          this.burst(x, y, 8, WORLD.spike);
          if (event.points > 0) this.popup(x, y, `+${event.points}`, "#ffffff");
          break;
        case "grow":
          this.burst(x, y, 12, WORLD.shell);
          break;
        case "hurt":
          this.burst(x, y, 10, WORLD.heart);
          break;
        case "died":
          this.burst(x, y, 16, WORLD.heart);
          break;
        case "reachedGoal":
          // Confetti, not a puff. Winning should cost more pixels than dying.
          this.burst(x, y, 40, WORLD.coin);
          break;
      }
    }
  }

  private burst(x: number, y: number, count: number, color: string): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * 1.4,
        vy: Math.sin(angle) * 1.4 - 0.6,
        life: 18,
        maxLife: 18,
        size: 2,
        color,
      });
    }
  }

  private popup(x: number, y: number, text: string, color: string): void {
    this.particles.push({ x, y, vx: 0, vy: -0.5, life: 40, maxLife: 40, size: 0, color, text });
  }

  private stepParticles(): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (!p.text) p.vy += 0.12; // sparkles fall; text floats
      p.life -= 1;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  /**
   * Size the play view to the container at a whole-number scale.
   *
   * ---------------------------------------------------------------------------
   * WHY THE DEVICE RATIO IS PART OF CHOOSING THE SCALE
   * ---------------------------------------------------------------------------
   * The backing store is CSS-pixel sized and the browser upscales it by the
   * device ratio D. That is not a shortcut: nearest-neighbour upscaling of an
   * already nearest-neighbour image by an INTEGER factor is exact, so rendering
   * at backing k and letting the browser scale by D gives output identical to
   * rendering at backing k*D, for strictly less work.
   *
   * The problem is when k * D is NOT an integer. On a Windows laptop at 125% or
   * 150% display scaling -- extremely common -- one game pixel then covers a
   * fractional number of device pixels, so some columns come out one physical
   * pixel wider than their neighbours. It is the exact artefact the whole art
   * direction exists to avoid, happening one layer below where you would look
   * for it, and no CSS property repairs it.
   *
   * So the fix is in the CHOICE of k: step down to the largest scale whose
   * product with the device ratio is whole. At D = 1.5 that means an even
   * scale; at 1.25, a multiple of 4. The game comes out somewhat smaller and
   * perfectly uniform, which is the right trade for pixel art. If no scale
   * works (an exotic ratio like 1.1) the plain floor is kept and the result is
   * no worse than it was.
   */
  resize(containerW: number, containerH: number, dpr = 1): void {
    const fit = Math.min(containerW / LOGICAL_W, containerH / LOGICAL_H);
    let scale = Math.max(1, Math.floor(fit));
    for (let n = scale; n >= 2; n--) {
      if (Number.isInteger(n * dpr)) {
        scale = n;
        break;
      }
    }
    this.scale = scale;

    const w = LOGICAL_W * scale;
    const h = LOGICAL_H * scale;
    this.canvas.width = w;
    this.canvas.height = h;

    const style = this.canvas.style;
    style.width = `${w}px`;
    style.height = `${h}px`;
    // Positioned rather than flex-centred: centring an odd-width canvas in an
    // odd-width box leaves it on a half CSS pixel, which at a fractional device
    // ratio is a resample of the entire image.
    style.position = "absolute";
    style.left = `${Math.floor((containerW - w) / 2)}px`;
    style.top = `${Math.floor((containerH - h) / 2)}px`;
    // Set here rather than as a Tailwind arbitrary class. This is load-bearing
    // rendering behaviour and must not depend on a JIT that has twice dropped
    // newly-added classes in this project.
    style.imageRendering = "pixelated";

    this.ctx.imageSmoothingEnabled = false;
  }

  draw(sim: Sim, options: RenderOptions): void {
    const ctx = this.ctx;
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;

    this.consumeEvents(sim);
    this.stepParticles();
    this.clearedFrames = sim.cleared ? this.clearedFrames + 1 : 0;

    // Screen shake is applied to the CAMERA, then snapped, so the whole scene
    // moves together as whole pixels. Shaking sprites while leaving the tilemap
    // still would just look like the sprites are broken.
    let camX = Math.floor(toPxFloat(sim.cameraX));
    let camY = Math.floor(toPxFloat(sim.cameraY));
    if (sim.shakeFrames > 0) {
      // Alternating rather than random: deterministic, and a regular buzz reads
      // as impact where noise reads as a glitch.
      const phase = sim.shakeFrames % 2 === 0 ? 1 : -1;
      camX += phase * sim.shakeMagnitude;
      camY -= phase * sim.shakeMagnitude;
    }
    const camera = { x: camX, y: camY, zoom: 1 };

    // Sky first, and it reads the camera so the layers can lag it.
    drawSky(ctx, camX, camY);

    /**
     * GOING DOWN A PIPE MEANS GOING BEHIND IT.
     *
     * While in transit the player is drawn BEFORE the tilemap, so the pipe he
     * is climbing into covers him as he sinks. Drawn in the usual place he
     * slides down the FRONT of the pipe and the whole illusion collapses -
     * it reads as a character standing in front of some scenery, moving
     * downwards for no reason.
     *
     * Only during transit: for the rest of the game the player must be in
     * front, or he vanishes behind any block he walks past.
     */
    const inPipe = sim.player.pipeFrames > 0;
    if (inPipe) this.drawPlayer(sim, camX, camY, options);

    drawTiles(
      ctx,
      gridView(sim.area.parts, sim.area.width, sim.area.height),
      camera,
      LOGICAL_W,
      LOGICAL_H,
    );

    this.drawMarkers(sim, camX, camY);
    this.drawEntities(sim, camX, camY);
    if (!inPipe) this.drawPlayer(sim, camX, camY, options);
    this.drawParticles(camX, camY);
    this.drawHud(sim);

    if (sim.cleared) this.drawCleared(sim);
  }

  /**
   * The win moment.
   *
   * A dithered dim rather than a translucent wash: alpha produces a smooth
   * grey veil, which is the vector idiom this whole pass is removing. A 2x2
   * checkerboard of hard pixels covers half the screen and reads, correctly, as
   * "the game has paused to tell you something".
   *
   * The plaque grows in whole-pixel steps so it SNAPS open. Easing it would
   * make it a web modal.
   */
  private drawCleared(sim: Sim): void {
    const ctx = this.ctx;

    if (!this.dither) this.dither = makeDither();
    if (this.dither) {
      const pattern = ctx.createPattern(this.dither, "repeat");
      if (pattern) {
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      }
    }

    const grow = Math.min(10, this.clearedFrames);
    const h = Math.round((72 * grow) / 10);
    if (h < 8) return;
    const w = 192;
    const x = Math.round((LOGICAL_W - w) / 2);
    const y = Math.round((LOGICAL_H - h) / 2);

    // Built from the same vocabulary as every button in the interface: dark
    // outline, light top-left, dark bottom-right.
    ctx.fillStyle = COLORS.plaqueInk;
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = COLORS.plaque;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = COLORS.plaqueLit;
    ctx.fillRect(x, y, w, 2);
    ctx.fillRect(x, y, 2, h);
    ctx.fillStyle = COLORS.plaqueShade;
    ctx.fillRect(x, y + h - 2, w, 2);
    ctx.fillRect(x + w - 2, y, 2, h);

    if (grow < 10) return;
    const mid = LOGICAL_W / 2;
    drawText(ctx, "LEVEL CLEAR", mid, y + 10, { ink: WORLD.coinLit, scale: 2, align: "center" });
    if (this.clearedFrames > 20) {
      drawText(ctx, `COINS ${sim.coins}`, mid, y + 32, { ink: "#ffffff", align: "center" });
    }
    if (this.clearedFrames > 30) {
      drawText(ctx, `SCORE ${sim.score}`, mid, y + 44, { ink: WORLD.shellLit, align: "center" });
    }
    if (Math.floor(this.clearedFrames / 20) % 2 === 0) {
      drawText(ctx, "PRESS R", mid, y + 58, { ink: WORLD.coin, align: "center" });
    }
  }

  private drawMarkers(sim: Sim, camX: number, camY: number): void {
    // Pipe ends. These are NOT entities - they are holes in the world, so they
    // never went through the spawner and, until this existed, were not drawn in
    // play at all: the player warped through an invisible pipe.
    for (const pipe of sim.area.pipes) {
      // A plain green pipe already draws its own lip as a tile; only the
      // coloured warps need a mouth painted over the top.
      if (pipe.partId === PIPE_TILE_ID) continue;
      drawPipeMouth(
        this.ctx,
        pipe.tx * TILE_PX - camX,
        pipe.ty * TILE_PX - camY,
        TILE_PX,
        partArt(pipe.partId),
      );
    }
    drawGoal(this.ctx, sim.area.goalTx * TILE_PX - camX, sim.area.goalTy * TILE_PX - camY);
  }

  /**
   * Draw every live entity.
   *
   * Reads straight from the SoA store, no per-entity objects are created, so
   * rendering allocates nothing and cannot trigger a GC pause mid-frame.
   */
  private drawEntities(sim: Sim, camX: number, camY: number): void {
    const ctx = this.ctx;
    const s = sim.world.store;
    for (let i = 0; i < s.capacity; i++) {
      if (!sim.world.isActive(i)) continue;
      const def = anyDefFor(s.kind[i]);
      if (!def) continue;

      const w = toPxFloat(s.halfW[i] as Fixed) * 2;
      const h = toPxFloat(s.halfH[i] as Fixed) * 2;
      const x = Math.round(toPxFloat(s.x[i] as Fixed) - w / 2) - camX;
      const y = Math.round(toPxFloat(s.y[i] as Fixed) - h / 2) - camY;

      if (s.state[i] === EntityState.DYING) {
        // Squash on death: the shape flattening is what reads as "defeated"
        // without any art at all.
        const t = s.timer[i] / DEATH_FRAMES;
        const squashed = Math.max(2, h * t);
        ctx.globalAlpha = Math.max(0.2, t);
        ctx.fillStyle = partArt(s.kind[i]).base;
        ctx.fillRect(x, y + (h - squashed), w, squashed);
        ctx.globalAlpha = 1;
        continue;
      }

      const facing = (s.face[i] === 1 ? 1 : -1) as 1 | -1;
      switch (s.kind[i]) {
        case 100:
          drawCoin(ctx, x, y, w, h, sim.tick);
          break;
        case 101:
          drawGem(ctx, x, y, w, h);
          break;
        case 102:
          drawHeart(ctx, x, y, w, h);
          break;
        case 110:
          drawWalker(ctx, x, y, w, h, facing, sim.tick);
          break;
        case 111:
          drawShellWalker(ctx, x, y, w, h, facing, sim.tick);
          break;
        case SHELL_PART:
          drawShell(ctx, x, y, w, h, sim.tick);
          break;
        default:
          ctx.fillStyle = partArt(s.kind[i]).base;
          ctx.fillRect(x, y, w, h);
      }
    }
  }

  /** Decorative only; see the note in Sim about what belongs where. */
  private drawParticles(camX: number, camY: number): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const x = Math.round(p.x) - camX;
      const y = Math.round(p.y) - camY;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      if (p.text) {
        // The same bitmap face the HUD uses, so a score popup and the coin
        // counter are visibly the same typeface rather than two different ones.
        drawText(ctx, p.text, x, y, { ink: p.color, align: "center" });
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(x, y, p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }
  }

  /**
   * THE HUD, STAMPED ONTO THE WORLD.
   *
   * Drawn in the game's own bitmap font with a hard outline and a hard shadow,
   * so it reads over a bright sky and over a brick wall alike and needs no bar,
   * no panel and no scrim behind it. That is the whole of the brief's "the HUD
   * belongs to the world": it is not printed underneath the game, it is part of
   * the picture.
   *
   * Two deliberate removals from what used to be here:
   *
   *   SCORE is gone. Six digits of prime screen space for a number a
   *   young player does not use, when the +100 popups already show scoring in
   *   the world at the moment it happens. It reappears on the clear plaque,
   *   where there is time to read it.
   *
   *   The words BIG and SMALL are gone, replaced by a gem pip. Five
   *   characters of reading work for one glance of information - which is rule
   *   one of this design system applied to the canvas.
   */
  private drawHud(sim: Sim): void {
    const ctx = this.ctx;
    const top = 5;

    // Lives, then coins, top left. Lives first because it is the number a
    // young player checks when something has just gone wrong.
    drawHeadPip(ctx, 6, top);
    drawText(ctx, `x${sim.lives}`, 17, top, {
      ink: sim.lives === 0 ? WORLD.heartLit : "#ffffff",
    });

    drawCoinPip(ctx, 48, top);
    drawText(ctx, `x${sim.coins}`, 59, top, { ink: "#ffffff" });

    // Time: top right, and it starts shouting before it runs out. Red under
    // thirty seconds is the same threshold that speeds the music up, so two
    // senses report the same thing at the same moment.
    if (sim.timeLeft > 0) {
      const urgent = sim.timeLeft <= 30;
      const flashOff = sim.timeLeft <= 10 && Math.floor(sim.tick / 8) % 2 === 0;
      if (!flashOff) {
        const mins = Math.floor(sim.timeLeft / 60);
        const secs = sim.timeLeft % 60;
        const label = `${mins}:${String(secs).padStart(2, "0")}`;
        const x = LOGICAL_W - 8;
        drawText(ctx, label, x, top, {
          ink: urgent ? WORLD.heartLit : "#ffffff",
          align: "right",
        });
        drawText(ctx, "TIME", x - textWidth(label) - 8, top, {
          ink: urgent ? WORLD.heart : WORLD.coin,
          align: "right",
        });
      }
    }

    // Power: a pip, not a word. Full colour when big, a flat silhouette when
    // small, so the difference is a shape you see rather than a word you read.
    drawGemPip(ctx, LOGICAL_W - 14, top + 10, sim.player.powerTier > 0);
  }

  private drawPlayer(sim: Sim, camX: number, camY: number, options: RenderOptions): void {
    const ctx = this.ctx;
    const p = sim.player;
    const w = toPxFloat(p.halfW as Fixed) * 2;
    const h = toPxFloat(p.halfH as Fixed) * 2;
    const x = Math.floor(toPxFloat(p.x as Fixed) - w / 2) - camX;
    const y = Math.floor(toPxFloat(p.y as Fixed) - h / 2) - camY;

    // Blink while invulnerable. Without this, taking a hit and surviving is
    // indistinguishable from taking a hit and nothing happening.
    if (p.iFrames > 0 && Math.floor(p.iFrames / 4) % 2 === 0) return;

    drawHero(
      ctx,
      x,
      y,
      w,
      h,
      p.face === 1 ? 1 : -1,
      p.vx !== 0,
      p.grounded,
      sim.tick,
      // Passing velocity is what unlocks the skid pose: running one way while
      // pressing the other is a distinct thing the player is doing, and showing
      // nothing for it reads as the controls being unresponsive.
      p.vx,
    );

    if (options.showHitboxes) {
      ctx.strokeStyle = COLORS.hitbox;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
  }
}

export { COLORS as PLAY_COLORS };
