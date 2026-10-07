import { fromPx, fromTiles, raw, type Fixed } from "./math/fixed";
import { LOGICAL_H, LOGICAL_W, TICK_HZ, TILE } from "./core/constants";
import { Button, EMPTY_INPUT, isHeld, type InputFrame } from "./core/input";
import { World } from "./core/world";
import type { Tilemap } from "./collision/tilemap";
import type { MoveResult } from "./collision/resolve";
import { compileLevel, type CompiledArea, type PipeLink } from "./level/compile";
import { exitPipe, stepPipe, tryEnterPipe } from "./systems/pipes";
import type { LevelDoc } from "@/format/level";
import {
  createPlayer,
  damagePlayer,
  setPowerTier,
  stepPlayer,
  type PlayerState,
} from "./systems/player";
import {
  resolveEntityStacking,
  resolvePlayerVsEntities,
  streamEntities,
  touchingHazardTile,
  updateEntities,
  type Interaction,
} from "./systems/entities";

/**
 * THE SIMULATION.
 *
 * One tick in, one world state out. No canvas, no DOM, no clock of its own,
 * the host drives it, which is what lets the same code run headless in Node to
 * verify a replay. `tick` is the only notion of time; nothing here asks what
 * time it is in the real world.
 *
 * ---------------------------------------------------------------------------
 * JUICE LIVES IN THE SIM, NOT THE RENDERER
 * ---------------------------------------------------------------------------
 * Hitstop and screen shake are simulated, not animated. Hitstop actually FREEZES
 * the world for a few frames, which is the entire reason a stomp feels like it
 * connects; a purely visual wobble does not. Keeping both in the sim means a
 * replay reproduces them exactly, and it keeps the renderer a pure function of
 * world state.
 *
 * Purely decorative effects (coin sparkles, score popups) are emitted as
 * EVENTS and owned by the renderer, because nothing about them can affect the
 * outcome of a run.
 */

const PLAYER_HALF_W: Fixed = fromPx(6);
const PIT_MARGIN_TILES = 4;

/** Frames the world freezes on a stomp. Long enough to feel, short enough not to drag. */
const STOMP_HITSTOP = 4;
const DAMAGE_HITSTOP = 8;

/**
 * Upward kick from a stomp, and the taller version when jump is held.
 *
 * Raw 1/4096 units rather than a float: -14336 is -3.5 px/frame, -20480 is -5.
 * Holding jump giving a bigger bounce is what turns chaining stomps into a
 * skill rather than a lottery.
 */
const STOMP_BOUNCE: Fixed = raw(-14336);
const STOMP_BOUNCE_HELD: Fixed = raw(-20480);

/**
 * Chained-stomp scoring.
 *
 * Bouncing from one enemy to the next without landing escalates the reward.
 * It is the most satisfying mechanics here and costs almost
 * nothing: the whole feature is this array plus a counter.
 */
const STOMP_CHAIN = [100, 200, 400, 800, 1000, 2000, 4000, 8000];

export type SimEventKind =
  | "died"
  | "reachedGoal"
  | "stomp"
  | "coin"
  | "grow"
  | "oneUp"
  | "pipe"
  | "hurt"
  | "jump"
  | "timeWarning";

export interface SimEvent {
  kind: SimEventKind;
  x: Fixed;
  y: Fixed;
  points: number;
}

export class Sim {
  area: CompiledArea;
  map: Tilemap;
  player: PlayerState;
  world = new World(1);

  tick = 0;
  deaths = 0;
  coins = 0;
  score = 0;
  cleared = false;

  /**
   * Lives in hand.
   *
   * Part of the sim rather than the host because it is a RULE, not a display:
   * it changes on collecting an extra life, on every hundredth coin and on every
   * death, and a replay has to reproduce all three. Starting at 3 is the
   * convention every player already knows, and it never falls below zero -
   * running out is not a game over here, because being sent back to a menu is
   * a punishment a young player learns nothing from.
   */
  lives = 3;

  /**
   * The pipe being travelled through, held from entering until arrival.
   *
   * Part of the sim state, so a replay that warps stays in step: the tick a
   * player disappears into a pipe and the tick he comes out of the far one are
   * both fixed numbers of frames apart.
   */
  private pendingPipe: PipeLink | null = null;

  /**
   * Seconds remaining, or 0 for an untimed level.
   *
   * One unit is one real second, NOT a faster-than-real tick. A young player reading "10" should get ten
   * seconds, because a clock that lies is a clock that feels unfair.
   */
  timeLeft = 0;
  private timeLimit = 0;
  private warnedOnTime = false;
  /** Ticks elapsed within the current second. */
  private clockTicks = 0;

  cameraX: Fixed = 0 as Fixed;
  cameraY: Fixed = 0 as Fixed;

  /** Frames the world is frozen for impact. */
  hitstop = 0;
  /** Remaining shake frames and its magnitude in pixels. */
  shakeFrames = 0;
  shakeMagnitude = 0;

  /** Enemies stomped without touching the ground, for chain scoring. */
  private stompChain = 0;

  /** Spawn rows retired for this run. See EntityContext.consumed. */
  private consumed: Uint8Array;

  lastResult: MoveResult | null = null;
  /** Events raised during the last step. Drained by the host each frame. */
  events: SimEvent[] = [];

  constructor(area: CompiledArea) {
    this.area = area;
    this.map = area.map;
    this.consumed = new Uint8Array(area.spawns.length);
    this.player = createPlayer(area.spawnX, area.spawnY, PLAYER_HALF_W, fromPx(12));
    this.updateCamera();
  }

  static fromDoc(doc: LevelDoc): Sim {
    const sim = new Sim(compileLevel(doc));
    sim.setTimeLimit(doc.timeLimit);
    return sim;
  }

  setTimeLimit(seconds: number): void {
    this.timeLimit = Math.max(0, seconds);
    this.timeLeft = this.timeLimit;
    this.warnedOnTime = false;
    this.clockTicks = 0;
  }

  /**
   * Swap in a freshly compiled level without recreating the Sim.
   *
   * This is what makes test-play instant: the editor recompiles the document it
   * already holds and hands it over. No load, no fetch, no round trip.
   */
  loadArea(area: CompiledArea, timeLimit = this.timeLimit): void {
    this.area = area;
    this.map = area.map;
    this.consumed = new Uint8Array(area.spawns.length);
    this.timeLimit = Math.max(0, timeLimit);
    this.cleared = false;
    this.coins = 0;
    this.score = 0;
    // A fresh run of a level starts fresh in every counter, lives included.
    // Pressing R to try again is `respawn`, not this, so retrying a hard jump
    // does not quietly hand back the lives it cost.
    this.lives = 3;
    this.respawn();
  }

  respawn(): void {
    this.player = createPlayer(this.area.spawnX, this.area.spawnY, PLAYER_HALF_W, fromPx(12));
    this.world.reset();
    // Dying puts every coin and enemy back. Anything else would mean a level
    // slowly empties out as you fail at it, so a hard section gets easier the
    // more you struggle, which reads as the game breaking, not helping.
    this.consumed.fill(0);
    this.timeLeft = this.timeLimit;
    this.warnedOnTime = false;
    this.clockTicks = 0;
    this.tick = 0;
    this.hitstop = 0;
    this.shakeFrames = 0;
    this.stompChain = 0;
    this.updateCamera();
  }

  step(input: InputFrame = EMPTY_INPUT): void {
    this.events.length = 0;

    // Hitstop freezes the WORLD, not the loop. The tick still advances and
    // input is still consumed, so the pause never eats a button press.
    if (this.hitstop > 0) {
      this.hitstop -= 1;
      this.decayShake();
      this.tick += 1;
      return;
    }

    const ctx = {
      world: this.world,
      map: this.map,
      area: this.area,
      cameraX: this.cameraX,
      cameraY: this.cameraY,
      consumed: this.consumed,
    };

    streamEntities(ctx);
    updateEntities(ctx);
    // After every entity has settled against the tilemap, and before the player
    // is resolved against them, so a stomp this tick sees the pile where it
    // will be drawn.
    resolveEntityStacking(ctx);

    // ---- Warp pipes ------------------------------------------------------
    //
    // While in transit the player system is skipped entirely: the sim is moving
    // him, so input, gravity, tile collision and enemies are all suspended.
    // Being eaten by a pipe should not be survivable OR fatal - it should be
    // uninterruptible.
    if (this.player.pipeFrames > 0) {
      const arrived = stepPipe(this.player);
      if (arrived && this.pendingPipe) {
        exitPipe(this.player, this.pendingPipe);
        this.pendingPipe = null;
      }
      // updateCamera follows the player directly with no smoothing, so coming
      // out of a pipe on the far side of the level is a hard cut - which is
      // what it should be. A camera that panned across the whole world would
      // spoil the surprise and take a second doing it.
      this.updateCamera();
      this.decayShake();
      this.tick += 1;
      return;
    }

    const entered = tryEnterPipe(this.player, input, this.area.pipes);
    if (entered) {
      this.pendingPipe = entered;
      this.emit("pipe", this.player.x, this.player.y, 0);
    }

    this.lastResult = stepPlayer(this.player, this.map, input);
    if (this.lastResult.grounded) this.stompChain = 0;
    if (this.player.justJumped) this.emit("jump", this.player.x, this.player.y, 0);

    this.tickClock();

    resolvePlayerVsEntities(ctx, this.player, (interaction) =>
      this.applyInteraction(interaction, input),
    );

    if (touchingHazardTile(this.map, this.player)) this.hurt();

    const pitY = ((this.map.height + PIT_MARGIN_TILES) * TILE) as Fixed;
    if (this.player.y > pitY) {
      this.die();
    } else if (!this.cleared && this.touchingGoal()) {
      this.cleared = true;
      this.emit("reachedGoal", this.player.x, this.player.y, 0);
    }

    this.world.sweep();
    this.decayShake();
    this.updateCamera();
    this.tick += 1;
  }

  private applyInteraction(interaction: Interaction, input: InputFrame): void {
    // Retire the spawn row FIRST, so nothing can re-enter the world this tick.
    const idx = interaction.spawnIndex;
    if (idx !== undefined && idx >= 0 && idx < this.consumed.length) this.consumed[idx] = 1;

    if (interaction.collected) {
      const { kind, x, y, points } = interaction.collected;
      if (kind === "coin") {
        this.coins += 1;
        // Every hundredth coin is a life, the way it has always worked. A young player
        // who cannot yet read a score can still count to a hundred coins.
        if (this.coins % 100 === 0) this.lives += 1;
      } else if (kind === "life") {
        this.lives += 1;
      } else {
        setPowerTier(this.player, this.player.powerTier + 1);
      }
      this.score += points;
      this.emit(kind === "coin" ? "coin" : kind === "life" ? "oneUp" : "grow", x, y, points);
      return;
    }

    if (interaction.stomped) {
      const { x, y, points } = interaction.stomped;
      // Escalating chain, capped at the top of the table.
      const step = Math.min(this.stompChain, STOMP_CHAIN.length - 1);
      const award = points > 0 ? STOMP_CHAIN[step] : 0;
      this.score += award;
      if (points > 0) this.stompChain += 1;

      const holdingJump = isHeld(input, Button.A);
      this.player.vy = holdingJump ? STOMP_BOUNCE_HELD : STOMP_BOUNCE;
      this.player.jumpRising = holdingJump;
      this.player.grounded = false;

      this.hitstop = STOMP_HITSTOP;
      this.addShake(2, 6);
      this.emit("stomp", x, y, award);
      return;
    }

    if (interaction.hurt) this.hurt();
  }

  /**
   * Count the clock down, once per second of ticks.
   *
   * Counting in whole ticks rather than accumulating a float keeps the timer
   * exactly reproducible in a replay: a drifting clock would make a replayed
   * run end at a different moment than the recorded one.
   */
  private tickClock(): void {
    if (this.timeLimit <= 0 || this.cleared) return;

    // An explicit counter rather than `tick % 60`. The tick counter is reset by
    // respawn and is incremented AFTER this runs, so modular arithmetic on it
    // is off by one and silently changes meaning whenever either moves.
    this.clockTicks += 1;
    if (this.clockTicks >= TICK_HZ) {
      this.clockTicks = 0;
      this.timeLeft -= 1;
    }

    if (!this.warnedOnTime && this.timeLeft <= 30 && this.timeLeft > 0) {
      this.warnedOnTime = true;
      this.emit("timeWarning", this.player.x, this.player.y, 0);
    }
    // Running out is fatal regardless of power tier: the one hazard
    // a power gem cannot save you from.
    if (this.timeLeft <= 0) this.die();
  }

  private hurt(): void {
    if (this.player.iFrames > 0) return;
    const died = damagePlayer(this.player);
    this.hitstop = DAMAGE_HITSTOP;
    this.addShake(3, 12);
    this.emit("hurt", this.player.x, this.player.y, 0);
    if (died) this.die();
  }

  private die(): void {
    this.deaths += 1;
    // Floored at zero rather than ending the run. Being sent back to a menu
    // teaches a young player nothing except that the game took their level
    // away; the count is a score to protect, not a gate.
    this.lives = Math.max(0, this.lives - 1);
    this.emit("died", this.player.x, this.player.y, 0);
    this.respawn();
  }

  private emit(kind: SimEventKind, x: Fixed, y: Fixed, points: number): void {
    this.events.push({ kind, x, y, points });
  }

  private addShake(magnitude: number, frames: number): void {
    // Take the stronger of the two rather than summing: a stomp landing during
    // an existing shake should not stack into a screen-destroying jolt.
    this.shakeMagnitude = Math.max(this.shakeMagnitude, magnitude);
    this.shakeFrames = Math.max(this.shakeFrames, frames);
  }

  private decayShake(): void {
    if (this.shakeFrames > 0) {
      this.shakeFrames -= 1;
      if (this.shakeFrames === 0) this.shakeMagnitude = 0;
    }
  }

  private touchingGoal(): boolean {
    const gx = fromTiles(this.area.goalTx);
    const gy = fromTiles(this.area.goalTy);
    const dx = Math.abs(this.player.x - (gx + TILE / 2));
    const dy = Math.abs(this.player.y - (gy + TILE / 2));
    // Generous: the goal is a reward, not a precision test.
    return dx < TILE && dy < TILE * 2;
  }

  private updateCamera(): void {
    const halfViewX = fromPx(LOGICAL_W / 2);
    const halfViewY = fromPx(LOGICAL_H / 2);
    const maxX = Math.max(0, this.map.width * TILE - fromPx(LOGICAL_W)) as Fixed;
    const maxY = Math.max(0, this.map.height * TILE - fromPx(LOGICAL_H)) as Fixed;

    let cx = (this.player.x - halfViewX) as Fixed;
    let cy = (this.player.y - halfViewY) as Fixed;
    if (cx < 0) cx = 0 as Fixed;
    if (cy < 0) cy = 0 as Fixed;
    if (cx > maxX) cx = maxX;
    if (cy > maxY) cy = maxY;

    this.cameraX = cx;
    this.cameraY = cy;
  }
}
