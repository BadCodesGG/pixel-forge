import { describe, expect, it } from "vitest";
import type { Sim } from "@/engine/sim";
import { GameLoop } from "./loop";
import { Renderer } from "./renderer";

// Only the constructor touches the canvas, and it only asks for a 2D context.
const fakeCanvas = () => ({ getContext: () => ({}) }) as unknown as HTMLCanvasElement;
const simWithCoin = () => ({ events: [{ kind: "coin", x: 0, y: 0 }] }) as unknown as Sim;

describe("Renderer effects", () => {
  it("turns a coin event into sparkles and a score popup", () => {
    const renderer = new Renderer(fakeCanvas());
    renderer.consumeEvents(simWithCoin());
    expect(renderer.particleCount).toBe(7);
  });

  it("reset clears the previous run's particles", () => {
    const renderer = new Renderer(fakeCanvas());
    renderer.consumeEvents(simWithCoin());
    renderer.reset();
    expect(renderer.particleCount).toBe(0);
  });
});

describe("GameLoop.attachSim", () => {
  it("starts a new level with no particles left over from the last one", () => {
    const loop = new GameLoop(fakeCanvas());
    const renderer = (loop as unknown as { renderer: Renderer }).renderer;
    renderer.consumeEvents(simWithCoin());
    expect(renderer.particleCount).toBeGreaterThan(0);
    loop.attachSim({ events: [] } as unknown as Sim);
    expect(renderer.particleCount).toBe(0);
  });
});
