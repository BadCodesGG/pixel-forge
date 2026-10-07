import { describe, expect, it } from "vitest";
import {
  COIN,
  HERO_BIG,
  HERO_SMALL,
  GEM,
  HEART,
  SHELL,
  SHELL_WALKER,
  WALKER,
} from "./actors";
import type { PixelAnim, PixelSprite } from "./pixels";

/**
 * Data validation for hand-drawn sprites.
 *
 * A grid whose row is one character short does not throw, does not fail to
 * compile, and does not look obviously broken - the sprite just shifts. That is
 * exactly the class of bug this project keeps getting bitten by, so it gets a
 * mechanical guard.
 *
 * Deliberately touches no DOM: vitest runs in the `node` environment here, so
 * only the data can be checked, never the rasteriser.
 */

const sprites: PixelSprite[] = [
  ...Object.values(HERO_SMALL),
  ...Object.values(HERO_BIG),
  GEM,
  HEART,
];

const anims: PixelAnim[] = [WALKER, SHELL_WALKER, SHELL, COIN];

function checkGrid(label: string, rows: readonly string[], w: number, h: number, palette: Record<string, string>) {
  expect(rows, `${label}: wrong row count`).toHaveLength(h);
  rows.forEach((row, y) => {
    expect(`${label}[${y}] "${row}"`).toHaveLength(`${label}[${y}] ""`.length + w);
    for (const ch of row) {
      if (ch === ".") continue;
      expect(palette[ch], `${label}[${y}]: no palette entry for "${ch}"`).toBeDefined();
    }
  });
}

describe("actor sprites", () => {
  it.each(sprites.map((s) => [s.id, s] as const))("%s is a well-formed grid", (_id, sprite) => {
    checkGrid(sprite.id, sprite.rows, sprite.w, sprite.h, sprite.palette as Record<string, string>);
  });

  it.each(anims.map((a) => [a.id, a] as const))("%s frames are well-formed", (_id, anim) => {
    expect(anim.frames.length).toBeGreaterThan(1);
    anim.frames.forEach((frame, i) => {
      checkGrid(`${anim.id}#${i}`, frame, anim.w, anim.h, anim.palette as Record<string, string>);
    });
  });

  it("gives every sprite a unique cache id", () => {
    const ids = [...sprites.map((s) => s.id), ...anims.map((a) => a.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes the big hero taller than the small one, not merely scaled", () => {
    expect(HERO_BIG.idle.w).toBe(HERO_SMALL.idle.w);
    expect(HERO_BIG.idle.h).toBeGreaterThan(HERO_SMALL.idle.h);
  });

  it("keeps every hero pose the same size, so a pose change never resizes him", () => {
    const small = Object.values(HERO_SMALL);
    for (const pose of small) {
      expect(pose.h, `${pose.id} is a different height`).toBe(small[0].h);
      expect(pose.w).toBe(small[0].w);
    }
  });

  it("draws the extra life as a different shape and colour from the power gem", () => {
    expect(HEART.rows).not.toEqual(GEM.rows);
    expect(HEART.palette.c).not.toBe(GEM.palette.c);
  });

  it("draws the power gem symmetric in outline, so it reads as a cut stone", () => {
    const silhouette = (rows: readonly string[]) =>
      rows.map((r) => [...r].map((ch) => (ch === "." ? "." : "x")).join(""));
    for (const sprite of [GEM, HEART]) {
      for (const row of silhouette(sprite.rows)) {
        expect(row, `${sprite.id} silhouette`).toBe([...row].reverse().join(""));
      }
    }
  });
});
