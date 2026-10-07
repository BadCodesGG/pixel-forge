import { describe, expect, it } from "vitest";
import { compileArea, validateLevel } from "./level/compile";
import { createEmptyLevel, makeCell } from "@/format/level";
import { partByKey } from "@/format/parts";
import { Sim } from "./sim";
import { Button, makeInput } from "./core/input";
import { PIPE_FRAMES } from "./systems/pipes";
import type { AreaDoc, LevelDoc, ObjectDoc } from "@/format/level";

/**
 * Warp pipes, and the two rules that make them work without a format change:
 * mouths pair by COLOUR, and each one works out which way it opens from the
 * pipe blocks next to it.
 *
 * These assert human-meaningful outcomes - "you come out of the other pipe" -
 * rather than byte constants, so a failure says what changed about the feel.
 */

const PIPE = partByKey("pipe")!.id;
const GROUND = partByKey("ground")!.id;

/** A level with a floor, and whatever tiles and objects a test needs. */
function level(
  tiles: { tx: number; ty: number; part: number }[],
  objects: { part: string; tx: number; ty: number }[],
): LevelDoc {
  const base = createEmptyLevel("pipe-test");
  const area = base.areas[0];
  const next = new Uint16Array(area.tiles);

  for (let tx = 0; tx < area.w; tx++) next[22 * area.w + tx] = makeCell(GROUND, 0);
  for (const t of tiles) next[t.ty * area.w + t.tx] = makeCell(t.part, 0);

  const objs: ObjectDoc[] = objects.map((o, i) => ({ id: 100 + i, part: o.part, tx: o.tx, ty: o.ty }));
  const nextArea: AreaDoc = { ...area, tiles: Array.from(next), objects: [...area.objects, ...objs] };
  return { ...base, areas: [nextArea] };
}

describe("plain green pipes are warps on their own", () => {
  it("links two pipes built from nothing but pipe blocks", () => {
    // WHAT SOMEBODY ACTUALLY DOES: build two pipes, expect to travel between
    // them. Requiring a coloured marker dropped on top of each was a two-step
    // assembly rule that had to be explained, and a rule that has to be
    // explained is one a young player never discovers.
    const doc = level(
      [
        { tx: 10, ty: 21, part: PIPE },
        { tx: 10, ty: 20, part: PIPE },
        { tx: 40, ty: 21, part: PIPE },
        { tx: 40, ty: 20, part: PIPE },
      ],
      [],
    );
    const pipes = compileArea(doc.areas[0]).pipes;
    expect(pipes).toHaveLength(2);
    // The mouth is the TOP of each pipe - the only place you could climb in.
    expect(pipes.find((p) => p.tx === 10)!.ty).toBe(20);
    expect(pipes.find((p) => p.tx === 10)!.dir).toBe("down");
    expect(pipes.find((p) => p.tx === 10)!.toTx).toBe(40);
  });

  it("treats only the open end as a mouth, not every tile of the pipe", () => {
    const doc = level(
      [
        { tx: 10, ty: 21, part: PIPE },
        { tx: 10, ty: 20, part: PIPE },
        { tx: 10, ty: 19, part: PIPE },
        { tx: 40, ty: 21, part: PIPE },
        { tx: 40, ty: 20, part: PIPE },
      ],
      [],
    );
    const pipes = compileArea(doc.areas[0]).pipes;
    // A three-tile pipe still has exactly one way in.
    expect(pipes.filter((p) => p.tx === 10)).toHaveLength(1);
    expect(pipes.find((p) => p.tx === 10)!.ty).toBe(19);
  });

  it("does not link a single lonely pipe to itself", () => {
    const doc = level([{ tx: 10, ty: 21, part: PIPE }], []);
    expect(compileArea(doc.areas[0]).pipes).toHaveLength(0);
  });
});

describe("pipe linking", () => {
  it("pairs two mouths of the same colour and reads their direction from the blocks", () => {
    // Two downward pipes: a mouth with pipe blocks beneath it.
    const doc = level(
      [
        { tx: 10, ty: 21, part: PIPE },
        { tx: 40, ty: 21, part: PIPE },
      ],
      [
        { part: "pipeBlue", tx: 10, ty: 20 },
        { part: "pipeBlue", tx: 40, ty: 20 },
      ],
    );

    // Filtered to the BLUE pair: the pipe blocks holding these mouths up are
    // themselves a green pair now, which is correct but not what this is about.
    const compiled = compileArea(doc.areas[0]);
    const blue = compiled.pipes.filter((p) => p.partId === 120);
    expect(blue).toHaveLength(2);

    const first = blue.find((p) => p.tx === 10)!;
    // Blocks below means you go in by pressing DOWN.
    expect(first.dir).toBe("down");
    expect(first).toMatchObject({ toTx: 40, toTy: 20 });
    // And you come back UP out of the far one.
    expect(first.exitDir).toBe("up");
  });

  it("links a sideways pipe by the blocks beside it", () => {
    const doc = level(
      [
        { tx: 11, ty: 21, part: PIPE },
        { tx: 41, ty: 21, part: PIPE },
      ],
      [
        { part: "pipeOrange", tx: 10, ty: 21 },
        { part: "pipeOrange", tx: 40, ty: 21 },
      ],
    );

    const compiled = compileArea(doc.areas[0]);
    // Blocks to the RIGHT means the mouth opens left, so you walk right into it.
    expect(compiled.pipes.find((p) => p.tx === 10)!.dir).toBe("right");
  });

  it("does not link colours that do not match", () => {
    const doc = level(
      [
        { tx: 10, ty: 21, part: PIPE },
        { tx: 40, ty: 21, part: PIPE },
      ],
      [
        { part: "pipeBlue", tx: 10, ty: 20 },
        { part: "pipePink", tx: 40, ty: 20 },
      ],
    );
    // Ignoring the green pair formed by the blocks underneath them, which is
    // correct behaviour of its own and not what this is checking.
    const coloured = compileArea(doc.areas[0]).pipes.filter((p) => p.partId !== 9);
    expect(coloured).toHaveLength(0);
  });

  it("links two ends dropped straight onto the ground, with no pipe blocks", () => {
    // THE CASE THAT MATTERS. This is what a person actually does first, and it
    // used to produce nothing at all plus a warning telling them to go and
    // build a pipe out of pipe blocks - a rule you can only learn by being
    // told, which means a young player never learns it.
    const doc = level(
      [],
      [
        { part: "pipeBlue", tx: 10, ty: 21 },
        { part: "pipeBlue", tx: 40, ty: 21 },
      ],
    );
    const pipes = compileArea(doc.areas[0]).pipes;
    expect(pipes).toHaveLength(2);
    // Ground underneath means you stand on it and press down.
    expect(pipes.find((p) => p.tx === 10)!.dir).toBe("down");
    expect(pipes.find((p) => p.tx === 10)!.toTx).toBe(40);
  });

  it("refuses to link a mouth floating in empty space", () => {
    // Nothing beside it at all, so there is genuinely nothing to infer from.
    const doc = level(
      [],
      [
        { part: "pipeBlue", tx: 10, ty: 5 },
        { part: "pipeBlue", tx: 40, ty: 5 },
      ],
    );
    expect(compileArea(doc.areas[0]).pipes).toHaveLength(0);
  });

  it("says so when a pipe has no partner", () => {
    const doc = level([{ tx: 10, ty: 21, part: PIPE }], [{ part: "pipeBlue", tx: 10, ty: 20 }]);
    const issues = validateLevel(doc);
    expect(issues.some((i) => i.message.includes("add a second one"))).toBe(true);
    // A half-built pipe must never block test-play.
    expect(issues.some((i) => i.severity === "error" && i.message.includes("pipe"))).toBe(false);
  });
});

describe("travelling through a pipe", () => {
  it("takes the player in one end and out the other", () => {
    const doc = level(
      [
        { tx: 10, ty: 21, part: PIPE },
        { tx: 40, ty: 21, part: PIPE },
      ],
      [
        { part: "pipeBlue", tx: 10, ty: 20 },
        { part: "pipeBlue", tx: 40, ty: 20 },
      ],
    );
    const sim = new Sim(compileArea(doc.areas[0]));

    // Stand the player on top of the near mouth.
    sim.player.x = (10 * 65536 + 32768) as typeof sim.player.x;
    sim.player.y = (20 * 65536 + 32768) as typeof sim.player.y;
    sim.player.grounded = true;

    const startX = sim.player.x;
    const down = makeInput([Button.DOWN], [Button.DOWN]);
    sim.step(down);
    expect(sim.player.pipeFrames, "pressing down on a pipe starts a warp").toBeGreaterThan(0);

    // Run out the swallow, the teleport, and the emerge, still HOLDING down.
    // A held direction must not re-enter the far pipe, or the two ends would
    // ping-pong forever.
    const heldDown = makeInput([Button.DOWN], []);
    for (let i = 0; i < PIPE_FRAMES * 2 + 4; i++) sim.step(heldDown);

    expect(sim.player.pipeFrames).toBe(0);
    expect(sim.player.x, "came out somewhere else entirely").not.toBe(startX);
    // Near the far mouth, in whole tiles.
    expect(Math.round(sim.player.x / 65536)).toBeGreaterThan(38);
    expect(Math.round(sim.player.x / 65536)).toBeLessThan(42);
  });

  it("warps from HOLDING down, not just from the exact frame of the press", () => {
    // THE REGRESSION. Requiring a press edge meant the press landed on a frame
    // where `grounded` was still false, got eaten by the alignment check, and
    // from then on the button was merely held - so standing on a pipe holding
    // down did nothing at all, forever. Which is what a person actually does.
    const doc = level(
      [],
      [
        { part: "pipeBlue", tx: 10, ty: 21 },
        { part: "pipeBlue", tx: 40, ty: 21 },
      ],
    );
    const sim = new Sim(compileArea(doc.areas[0]));
    sim.player.x = (10 * 65536 + 32768) as typeof sim.player.x;
    sim.player.y = (20 * 65536 + 32768) as typeof sim.player.y;

    // Note: NO press edge anywhere. Down is simply held down throughout.
    const held = makeInput([Button.DOWN], []);
    for (let i = 0; i < 8; i++) sim.step(held);
    expect(sim.player.pipeFrames, "holding down on a pipe has to open it").toBeGreaterThan(0);

    for (let i = 0; i < PIPE_FRAMES * 2 + 4; i++) sim.step(held);
    expect(Math.round(sim.player.x / 65536)).toBeGreaterThan(38);
  });

  it("does not bounce you back while the direction stays held", () => {
    const doc = level(
      [],
      [
        { part: "pipeBlue", tx: 10, ty: 21 },
        { part: "pipeBlue", tx: 40, ty: 21 },
      ],
    );
    const sim = new Sim(compileArea(doc.areas[0]));
    sim.player.x = (10 * 65536 + 32768) as typeof sim.player.x;
    sim.player.y = (20 * 65536 + 32768) as typeof sim.player.y;

    const held = makeInput([Button.DOWN], []);
    for (let i = 0; i < PIPE_FRAMES * 2 + 20; i++) sim.step(held);
    const landed = Math.round(sim.player.x / 65536);

    // Keep holding for another two full warps' worth of time. It must stay put:
    // the direction has to be released before a pipe will take you again.
    for (let i = 0; i < PIPE_FRAMES * 4; i++) sim.step(held);
    expect(Math.round(sim.player.x / 65536)).toBe(landed);

    // Let go, hold again, and it warps back.
    for (let i = 0; i < 4; i++) sim.step(makeInput([], []));
    for (let i = 0; i < PIPE_FRAMES * 2 + 20; i++) sim.step(held);
    expect(Math.round(sim.player.x / 65536)).not.toBe(landed);
  });

  it("ignores input while in transit, so a warp cannot be interrupted", () => {
    const doc = level(
      [
        { tx: 10, ty: 21, part: PIPE },
        { tx: 40, ty: 21, part: PIPE },
      ],
      [
        { part: "pipeBlue", tx: 10, ty: 20 },
        { part: "pipeBlue", tx: 40, ty: 20 },
      ],
    );
    const sim = new Sim(compileArea(doc.areas[0]));
    sim.player.x = (10 * 65536 + 32768) as typeof sim.player.x;
    sim.player.y = (20 * 65536 + 32768) as typeof sim.player.y;
    sim.player.grounded = true;

    sim.step(makeInput([Button.DOWN], [Button.DOWN]));
    const during = sim.player.pipeFrames;
    // Mash jump and run mid-warp.
    sim.step(makeInput([Button.A, Button.RIGHT], [Button.A]));
    expect(sim.player.pipeFrames).toBe(during - 1);
    expect(sim.player.vy).toBe(0);
  });
});
