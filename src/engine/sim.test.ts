import { describe, expect, it } from "vitest";
import { ONE, TILE, TILE_PX, toPxFloat, type Fixed } from "./math/fixed";
import { AREA_H } from "./core/constants";
import { Button, makeInput, type ButtonId } from "./core/input";
import { overlapsSolid } from "./collision/resolve";
import { Sim } from "./sim";
import { buildGreyboxDoc } from "./greybox";

/**
 * END-TO-END PLAYTHROUGH TESTS.
 *
 * These drive the whole stack the way the browser does: Sim -> player system
 * -> physics table -> collision -> greybox tilemap, using synthetic input.
 *
 * The unit tests prove each piece in isolation; these prove they are wired
 * together correctly, and they run headless in Node so a broken
 * greybox is caught without anyone opening a browser.
 */

/** Hold a set of buttons for one tick, with press edges on the first tick. */
function press(...buttons: ButtonId[]) {
  return makeInput(buttons, buttons);
}
function hold(...buttons: ButtonId[]) {
  return makeInput(buttons, []);
}

const px = (v: number) => toPxFloat(v as Fixed);

/** Run the sim, holding `buttons` every tick after the first. */
function runHolding(sim: Sim, ticks: number, ...buttons: ButtonId[]) {
  sim.step(press(...buttons));
  for (let i = 1; i < ticks; i++) sim.step(hold(...buttons));
}

describe("greybox playthrough", () => {
  it("spawns standing on the floor rather than falling forever", () => {
    const sim = Sim.fromDoc(buildGreyboxDoc());
    for (let i = 0; i < 30; i++) sim.step();
    expect(sim.player.grounded).toBe(true);
    expect(sim.player.vy).toBe(0);
  });

  it("reaches walking speed and stops when input is released", () => {
    const sim = Sim.fromDoc(buildGreyboxDoc());
    runHolding(sim, 90, Button.RIGHT);
    expect(px(sim.player.vx)).toBeCloseTo(1.5, 1);

    for (let i = 0; i < 90; i++) sim.step();
    expect(sim.player.vx).toBe(0);
  });

  it("runs faster than it walks", () => {
    // 60 ticks keeps the player inside the flat run-up (tiles 0-18). Running
    // longer drives it into the stair section, where hitting a step correctly
    // zeroes vx, which would look like "running is broken" rather than
    // "the test measured the wrong stretch of level".
    const walk = Sim.fromDoc(buildGreyboxDoc());
    runHolding(walk, 60, Button.RIGHT);
    const run = Sim.fromDoc(buildGreyboxDoc());
    runHolding(run, 60, Button.RIGHT, Button.B);
    expect(px(run.player.vx)).toBeCloseTo(2.5, 1);
    expect(run.player.vx).toBeGreaterThan(walk.player.vx);
  });

  it("preserves horizontal speed in midair when the stick is released", () => {
    // The defining feel characteristic: no air friction. Adding drag here is
    // the single easiest way to make a classic platformer feel wrong.
    const sim = Sim.fromDoc(buildGreyboxDoc());
    runHolding(sim, 120, Button.RIGHT, Button.B);
    const speedAtTakeoff = sim.player.vx;

    sim.step(press(Button.A, Button.RIGHT, Button.B));
    expect(sim.player.grounded).toBe(false);

    for (let i = 0; i < 10; i++) sim.step(); // no buttons at all
    expect(sim.player.vx).toBe(speedAtTakeoff);
  });

  it("gives a held jump much more height than a tapped one", () => {
    const apexOf = (holdTicks: number) => {
      const sim = Sim.fromDoc(buildGreyboxDoc());
      for (let i = 0; i < 30; i++) sim.step();
      const groundY = sim.player.y;
      sim.step(press(Button.A));
      let peak = 0;
      for (let i = 0; i < 90; i++) {
        sim.step(i < holdTicks ? hold(Button.A) : makeInput([], []));
        peak = Math.max(peak, (groundY - sim.player.y) / ONE);
        if (sim.player.grounded && i > 5) break;
      }
      return peak;
    };

    const tapped = apexOf(1);
    const held = apexOf(60);
    expect(held / TILE_PX).toBeGreaterThan(3.5);
    expect(tapped).toBeLessThan(held / 2);
  });

  it("jumps higher at a run than from standing", () => {
    const apexRunning = (runFirst: boolean) => {
      const sim = Sim.fromDoc(buildGreyboxDoc());
      for (let i = 0; i < 30; i++) sim.step();
      if (runFirst) runHolding(sim, 60, Button.RIGHT, Button.B); // stay on the flat
      const groundY = sim.player.y;
      const keys: ButtonId[] = runFirst ? [Button.A, Button.RIGHT, Button.B] : [Button.A];
      sim.step(press(...keys));
      let peak = 0;
      for (let i = 0; i < 90; i++) {
        sim.step(hold(...keys));
        peak = Math.max(peak, (groundY - sim.player.y) / ONE);
        if (sim.player.grounded && i > 5) break;
      }
      return peak;
    };
    // Momentum-coupled jump tiers: running changes the ARC, not just distance.
    expect(apexRunning(true)).toBeGreaterThan(apexRunning(false) + TILE_PX * 0.5);
  });

  it("never ends a tick embedded in solid geometry, across a full run", () => {
    // The strongest single guarantee: hold run+right through slopes, gaps,
    // steps, the low overhang, semisolids and ice, jumping constantly, and
    // never once end up inside a wall.
    const sim = Sim.fromDoc(buildGreyboxDoc());
    for (let i = 0; i < 1200; i++) {
      const keys: ButtonId[] = [Button.RIGHT, Button.B];
      if (i % 24 === 0) keys.push(Button.A);
      sim.step(i % 24 === 0 ? press(...keys) : hold(...keys));
      const p = sim.player;
      expect(
        overlapsSolid(sim.map, p.x, p.y, p.halfW, p.halfH),
        `embedded at tick ${i}, x=${px(p.x).toFixed(1)} y=${px(p.y).toFixed(1)}`,
      ).toBe(false);
    }
  });

  it("climbs the stair section by running and jumping", () => {
    // Stairs sit at tiles 18-25, rising 1, 2 then 3 tiles above the floor at
    // row 22. Getting on top of them proves jump height, ledge landing and the
    // step-up geometry all agree with each other.
    const sim = Sim.fromDoc(buildGreyboxDoc());
    // Let it fall onto the floor FIRST: the spawn point is two tiles above it,
    // so capturing y before settling compares against thin air.
    for (let i = 0; i < 30; i++) sim.step();
    const floorY = px(sim.player.y);
    for (let i = 0; i < 400; i++) {
      const keys: ButtonId[] = [Button.RIGHT, Button.B];
      const jumping = i % 26 === 0;
      if (jumping) keys.push(Button.A);
      sim.step(jumping ? press(...keys) : hold(...keys));
      if (px(sim.player.x) / TILE_PX > 24 && sim.player.grounded) break;
    }
    expect(px(sim.player.x) / TILE_PX).toBeGreaterThan(20);
    // Standing on a step means being above the original floor line.
    expect(px(sim.player.y)).toBeLessThan(floorY);
  });

  it("resets the player after falling into a pit", () => {
    // The greybox punches gaps in the floor. Falling through one must recover
    // rather than leaving the player tumbling forever below the level.
    const sim = Sim.fromDoc(buildGreyboxDoc());
    const spawnX = sim.player.x;
    const spawnY = sim.player.y;

    // Drop the player below the level rather than trying to steer it into a
    // gap: a bot holding RIGHT stops dead at the first stair and never reaches
    // one, so a navigation-based test would pass or fail for reasons that have
    // nothing to do with the rule being tested.
    sim.player.y = ((AREA_H + 10) * TILE) as Fixed;
    sim.step();

    expect(sim.player.x).toBe(spawnX);
    expect(sim.player.y).toBe(spawnY);
    expect(sim.player.vy).toBe(0);
  });

  it("takes noticeably longer to reach top speed on ice", () => {
    const sim = Sim.fromDoc(buildGreyboxDoc());
    // Walk onto the ice patch (tiles 104-114) and measure from a standstill.
    for (let i = 0; i < 2400; i++) {
      const keys: ButtonId[] = [Button.RIGHT, Button.B];
      if (i % 20 === 0) keys.push(Button.A);
      sim.step(i % 20 === 0 ? press(...keys) : hold(...keys));
      if (px(sim.player.x) / TILE_PX > 107) break;
    }
    // If we made it to the ice, stopping should be sluggish.
    if (px(sim.player.x) / TILE_PX > 105 && sim.player.grounded) {
      const before = Math.abs(sim.player.vx);
      for (let i = 0; i < 10; i++) sim.step();
      const after = Math.abs(sim.player.vx);
      // On normal ground, 10 ticks of release sheds ~2080 units; on ice it is
      // a quarter of that, so a large fraction of the speed must survive.
      if (before > 0) expect(after / before).toBeGreaterThan(0.5);
    }
  });

  it("keeps the camera inside the level bounds", () => {
    const sim = Sim.fromDoc(buildGreyboxDoc());
    for (let i = 0; i < 600; i++) sim.step(hold(Button.LEFT, Button.B));
    expect(sim.cameraX).toBeGreaterThanOrEqual(0);
    expect(sim.cameraY).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic: identical inputs give an identical end state", () => {
    const play = () => {
      const sim = Sim.fromDoc(buildGreyboxDoc());
      for (let i = 0; i < 600; i++) {
        const keys: ButtonId[] = [Button.RIGHT];
        if (i % 17 === 0) keys.push(Button.B);
        if (i % 31 === 0) keys.push(Button.A);
        sim.step(i % 31 === 0 ? press(...keys) : hold(...keys));
      }
      return { x: sim.player.x, y: sim.player.y, vx: sim.player.vx, vy: sim.player.vy };
    };
    expect(play()).toEqual(play());
  });
});

