import { SECONDS_PER_TICK } from "@/engine/core/constants";
import type { Sim } from "@/engine/sim";
import { InputSource } from "./input";
import { Renderer, type RenderOptions } from "./renderer";
import { audio } from "./audio";

/**
 * THE GAME LOOP.
 *
 * A fixed-timestep accumulator. The simulation always advances in whole 60 Hz
 * ticks no matter what the display does; only rendering happens at the
 * display's rate. That decoupling is what makes the game behave identically on
 * a 60 Hz laptop, a 144 Hz monitor and a throttled Chromebook, and it is the
 * precondition for replays being reproducible at all.
 *
 * ---------------------------------------------------------------------------
 * THE THREE GUARDS, AND WHAT EACH ONE PREVENTS
 * ---------------------------------------------------------------------------
 *   MAX_FRAME:   clamps a single frame's elapsed time. Without it, returning
 *                from a backgrounded tab hands the loop minutes of elapsed time
 *                and it tries to simulate all of it: the "spiral of death",
 *                where each catch-up frame takes longer than real time.
 *
 *   MAX_STEPS:   caps catch-up ticks per frame. Even inside the clamp, a stall
 *                could produce a burst that teleports the player through walls.
 *                Hitting the cap drops the backlog: better to lose a moment of
 *                time than the player's position.
 *
 *   resync:      on becoming visible again the clock is re-based, rather than
 *                measured against a timestamp from before the tab was hidden.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------------------------------------------------------
 * There is no "snap the frame delta to a multiple of the refresh rate"
 * heuristic. It is a popular trick and it does not work: at 144 Hz the frame
 * time (6.94 ms) is nowhere near a multiple of 16.67 ms so it never fires,
 * while on a 59.94 Hz display it DOES fire and quietly runs the simulation 0.1%
 * slow forever. A plain accumulator is correct at every refresh rate.
 */

const MAX_FRAME_SECONDS = 0.25;
const MAX_STEPS_PER_FRAME = 5;

export interface LoopStats {
  fps: number;
  stepsLastFrame: number;
  simMs: number;
  drawMs: number;
}

export class GameLoop {
  sim: Sim | null = null;
  readonly input = new InputSource();
  private renderer: Renderer;
  private rafHandle = 0;
  private accumulator = 0;
  private lastTime = 0;
  private started = false;
  private running = false;
  private paused = false;
  private frameSamples: number[] = [];

  stats: LoopStats = { fps: 0, stepsLastFrame: 0, simMs: 0, drawMs: 0 };
  options: RenderOptions = { showHitboxes: false };

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
  }

  /**
   * Point the loop at a simulation.
   *
   * The loop does not own or create one: the editor compiles a fresh area on
   * every test-play and hands it over, which is what makes entering play
   * instant rather than a load.
   */
  attachSim(sim: Sim): void {
    this.sim = sim;
    this.renderer.reset();
  }

  start(container?: HTMLElement | null): void {
    if (this.running) return;
    this.running = true;
    this.started = false;
    this.accumulator = 0;
    // A run always begins live. Leaving a stale pause from the previous run
    // would present a level that renders perfectly and ignores every button.
    this.paused = false;
    this.input.suspended = false;
    this.input.attach(window);
    if (container) this.resize(container);
    this.rafHandle = requestAnimationFrame(this.frame);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
    this.input.detach();
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  resize(container: HTMLElement, dpr = 1): void {
    // The device ratio reaches the renderer because the play scale has to be a
    // whole number of DEVICE pixels, not of CSS pixels. See Renderer.resize.
    this.renderer.resize(container.clientWidth, container.clientHeight, dpr);
  }

  /**
   * Freeze the simulation without tearing the loop down.
   *
   * WHY THIS EXISTS. Opening the controls guide mid-play used to kill you: the
   * loop steps unconditionally, so the seconds spent reading how to jump were
   * seconds of walking into a walker. A player asking for help is the one
   * moment the game must not be running.
   *
   * Rendering DELIBERATELY continues, so the frozen world stays on screen
   * behind the scrim rather than going black. One cosmetic consequence, noted
   * so it is not later mistaken for a bug: Renderer.draw steps particles, so
   * sparks keep drifting while paused. They cannot affect the outcome of a run,
   * which is exactly why they live outside the sim in the first place.
   */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.input.suspended = paused;
    if (paused) {
      // A key held at the moment of pausing would otherwise still be held on
      // the way out, and the player resumes already running into a wall.
      this.input.releaseKeys();
      this.input.clearVirtual();
    } else {
      // Re-base the clock, exactly as onVisibility does and for the same
      // reason: without it the first frame back is handed the whole time the
      // dialog was open and the player is teleported through the level.
      this.started = false;
      this.accumulator = 0;
    }
  }

  /** Draw once without advancing. Used by the editor, and by tests. */
  render(): void {
    if (this.sim) this.renderer.draw(this.sim, this.options);
  }

  /** Advance n ticks with a fixed input. For debugging and headless checks. */
  advance(ticks: number, input = this.input.consume()): void {
    if (!this.sim) return;
    for (let i = 0; i < ticks; i++) this.sim.step(input);
  }

  private onVisibility = (): void => {
    if (!document.hidden) {
      this.started = false;
      this.accumulator = 0;
    }
  };

  /**
   * The timestamp comes from requestAnimationFrame, not performance.now(): it
   * is the moment the frame will actually be presented, so using it keeps the
   * simulation aligned with what the player sees.
   */
  private frame = (nowMs: number): void => {
    if (!this.running) return;
    this.rafHandle = requestAnimationFrame(this.frame);
    const sim = this.sim;
    if (!sim) return;

    // Paused: keep painting, advance nothing. Returning before `started` is
    // touched means unpausing re-bases the clock rather than measuring against
    // a timestamp from before the dialog opened.
    if (this.paused) {
      this.renderer.draw(sim, this.options);
      return;
    }

    const now = nowMs / 1000;
    if (!this.started) {
      this.started = true;
      this.lastTime = now;
      return;
    }

    let frameTime = now - this.lastTime;
    this.lastTime = now;
    if (frameTime > MAX_FRAME_SECONDS) frameTime = MAX_FRAME_SECONDS;
    this.accumulator += frameTime;

    const simStart = performance.now();
    let steps = 0;
    while (this.accumulator >= SECONDS_PER_TICK && steps < MAX_STEPS_PER_FRAME) {
      // Input is consumed once per SIM TICK, never once per rendered frame.
      sim.step(this.input.consume());
      this.accumulator -= SECONDS_PER_TICK;
      steps += 1;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0; // drop the backlog
    const simEnd = performance.now();

    this.playSounds(sim);
    this.renderer.draw(sim, this.options);
    const drawEnd = performance.now();

    this.recordStats(frameTime, steps, simEnd - simStart, drawEnd - simEnd);
  };

  /**
   * Turn this tick's simulation events into sound.
   *
   * Read here rather than inside the sim, for the same reason particles are:
   * nothing audible can change the outcome of a run, so keeping it out of the
   * simulation means a replay stays byte-identical whatever the audio does.
   */
  private playSounds(sim: Sim): void {
    for (const event of sim.events) {
      switch (event.kind) {
        case "jump":
          audio.jump();
          break;
        case "coin":
          audio.coin();
          break;
        case "stomp":
          audio.stomp();
          break;
        case "grow":
          audio.grow();
          break;
        case "oneUp":
          audio.oneUp();
          break;
        case "pipe":
          audio.pipe();
          break;
        case "hurt":
          audio.hurt();
          break;
        case "died":
          audio.die();
          audio.setUrgent(false);
          break;
        case "reachedGoal":
          audio.win();
          audio.stopMusic();
          break;
        case "timeWarning":
          audio.setUrgent(true);
          break;
      }
    }
  }

  private recordStats(frameTime: number, steps: number, simMs: number, drawMs: number): void {
    this.frameSamples.push(frameTime);
    if (this.frameSamples.length > 60) this.frameSamples.shift();
    const mean = this.frameSamples.reduce((a, b) => a + b, 0) / this.frameSamples.length;
    this.stats = { fps: mean > 0 ? Math.round(1 / mean) : 0, stepsLastFrame: steps, simMs, drawMs };
  }
}
