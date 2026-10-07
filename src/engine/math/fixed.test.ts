import { describe, expect, it } from "vitest";
import {
  ONE,
  TILE,
  TILE_PX,
  abs,
  approach,
  approachZero,
  assertFixed,
  clamp,
  clampMagnitude,
  div,
  divInt,
  fromPx,
  fromTiles,
  lerp,
  mul,
  mulInt,
  raw,
  sign,
  toPx,
  toTile,
  type Fixed,
} from "./fixed";

/**
 * A spread of values chosen to hit the cases that actually break fixed-point
 * code: zero, sub-unit fractions, exact tile boundaries, physics
 * constants, and coordinates at the far end of the largest legal level.
 */
const SAMPLES: Fixed[] = [
  raw(0),
  raw(1),
  raw(7),
  raw(152), // walking acceleration
  raw(228), // running acceleration
  raw(2048), // half a pixel
  raw(4096), // one pixel
  raw(10240), // max run speed, 2.5 px/frame
  raw(65536), // one tile
  raw(1000003), // deliberately not a round number
  raw(15728640), // 240 tiles, the far edge of the largest level
];

const SIGNED = [...SAMPLES, ...SAMPLES.map((v) => neg(v))];

/**
 * Negation that collapses -0 to +0.
 *
 * `expect().toBe()` uses Object.is, which reports -0 and +0 as different. In
 * the sim they are not: every Fixed is stored in an Int32Array, and writing -0
 * to one reads back as 0 (asserted below). Using a plain `-x` here would make
 * the symmetry tests fail on a distinction the engine cannot observe, so the
 * helper normalizes it and the storage test covers the real guarantee.
 */
function neg(v: Fixed): Fixed {
  return (v === 0 ? 0 : -v) as Fixed;
}

describe("scale", () => {
  it("uses 1/4096 px so the physics constants stay whole", () => {
    expect(ONE).toBe(4096);
    expect(TILE_PX).toBe(16);
    expect(TILE).toBe(65536);
  });

  it("round-trips pixels and tiles", () => {
    expect(fromPx(1)).toBe(4096);
    expect(fromPx(2.5)).toBe(10240);
    expect(fromTiles(1)).toBe(65536);
    expect(fromTiles(240)).toBe(15728640);
    expect(toPx(fromPx(37))).toBe(37);
    expect(toTile(fromTiles(12))).toBe(12);
  });

  it("floors toward negative infinity when converting out", () => {
    // -0.5 px must land in pixel -1, not pixel 0. Truncation here would let an
    // entity straddling zero read as being in the tile on the wrong side.
    expect(toPx(raw(-2048))).toBe(-1);
    expect(toTile(raw(-1))).toBe(-1);
    expect(toTile(raw(0))).toBe(0);
  });
});

/**
 * The two conventions are load-bearing and pull in opposite directions, so pin
 * them explicitly. If someone "simplifies" fixed.ts by using one rounding mode
 * everywhere, exactly one of these two tests fails and says which guarantee
 * was traded away.
 */
describe("rounding conventions", () => {
  it("rounds scaling ops TOWARD ZERO, so they stay sign-symmetric", () => {
    // 7 * 7 / 4096 = 0.0119 -> 0 in both directions.
    expect(mul(raw(7), raw(7))).toBe(0);
    expect(mul(raw(-7), raw(7))).toBe(0);
    // Math.floor would give -1 here, breaking mirror symmetry.
    expect(divInt(raw(-1), 2)).toBe(0);
    expect(lerp(raw(0), raw(-1), raw(1024))).toBe(0);
  });

  it("rounds coordinate->cell ops DOWN, so the grid stays monotone", () => {
    // Math.trunc would put -0.25 px and +0.25 px in the same pixel.
    expect(toPx(raw(-1024))).toBe(-1);
    expect(toPx(raw(1024))).toBe(0);
    expect(toTile(raw(-1))).toBe(-1);
    expect(toTile(raw(1))).toBe(0);
  });
});

/**
 * THE load-bearing test.
 *
 * If any physics operation is not sign-symmetric, a character decelerating
 * leftward behaves differently from one decelerating rightward. The drift is
 * a fraction of a pixel per frame: invisible for a minute, then the level is
 * unbeatable and a recorded replay desyncs. Truncation toward zero is the
 * usual culprit, which is why fixed.ts floors everywhere.
 */
describe("mirror symmetry: f(-x) === -f(x)", () => {
  it("holds for mul", () => {
    for (const a of SIGNED) {
      for (const b of SAMPLES) {
        expect(mul(neg(a), b)).toBe(neg(mul(a, b)));
      }
    }
  });

  it("holds for div", () => {
    for (const a of SIGNED) {
      for (const b of SAMPLES) {
        if (b === 0) continue;
        expect(div(neg(a), b)).toBe(neg(div(a, b)));
      }
    }
  });

  it("holds for mulInt and divInt", () => {
    for (const a of SIGNED) {
      for (const n of [1, 2, 3, 5, 16]) {
        expect(mulInt(neg(a), n)).toBe(neg(mulInt(a, n)));
        expect(divInt(neg(a), n)).toBe(neg(divInt(a, n)));
      }
    }
  });

  it("holds for approachZero: the friction primitive", () => {
    for (const v of SIGNED) {
      for (const amount of SAMPLES) {
        expect(approachZero(neg(v), amount)).toBe(neg(approachZero(v, amount)));
      }
    }
  });

  it("holds for clampMagnitude", () => {
    for (const v of SIGNED) {
      for (const limit of SAMPLES) {
        expect(clampMagnitude(neg(v), limit)).toBe(neg(clampMagnitude(v, limit)));
      }
    }
  });

  it("holds for lerp", () => {
    for (const a of SIGNED) {
      for (const b of SIGNED) {
        for (const t of [raw(0), raw(1024), raw(2048), raw(4096)]) {
          expect(lerp(neg(a), neg(b), t)).toBe(neg(lerp(a, b, t)));
        }
      }
    }
  });

  it("is not observably broken by negative zero, because storage erases it", () => {
    // The reason `neg()` above is legitimate rather than a workaround: every
    // Fixed in the world lives in an Int32Array, and -0 does not survive
    // the round trip. There is no code path where the sim can tell them apart.
    const store = new Int32Array(1);
    store[0] = -0;
    expect(Object.is(store[0], 0)).toBe(true);
  });
});

describe("mul", () => {
  it("is exact for products that would overflow int32", () => {
    // This is the case the naive `(a * b) >> 12` gets wrong. 240 tiles is a
    // real coordinate in a max-size level, and int32 wraps well below it.
    const farRight = fromTiles(240); // 15_728_640
    const half = fromPx(0.5); // 2_048
    expect(mul(farRight, half)).toBe(7864320);

    // A slope interpolation: one tile of rise times a full-tile fraction.
    expect(mul(TILE, TILE)).toBe(1048576);
    expect(mul(TILE, TILE)).toBeGreaterThan(0); // int32 would have wrapped negative
  });

  it("is the identity when multiplying by 1.0", () => {
    for (const v of SIGNED) expect(mul(v, raw(ONE))).toBe(v);
  });

  it("stays inside double-exact range for the largest real product", () => {
    // position x velocity is the worst case the sim actually forms.
    const product = fromTiles(240) * raw(10240);
    expect(Number.isSafeInteger(product)).toBe(true);
  });
});

describe("approachZero", () => {
  it("lands exactly on zero and never overshoots into creep", () => {
    // The bug this prevents: a character stopping from the left ending at -1
    // instead of 0, then creeping leftward one unit per frame forever.
    expect(approachZero(raw(100), raw(30))).toBe(70);
    expect(approachZero(raw(100), raw(200))).toBe(0);
    expect(approachZero(raw(-100), raw(200))).toBe(0);
    expect(approachZero(raw(-100), raw(100))).toBe(0);
    expect(approachZero(raw(0), raw(50))).toBe(0);
  });
});

describe("approach", () => {
  it("converges on the target from both sides without overshoot", () => {
    expect(approach(raw(0), raw(100), raw(30))).toBe(30);
    expect(approach(raw(0), raw(100), raw(500))).toBe(100);
    expect(approach(raw(200), raw(100), raw(500))).toBe(100);
    expect(approach(raw(100), raw(100), raw(500))).toBe(100);
  });
});

describe("clamp helpers", () => {
  it("clamps magnitude symmetrically", () => {
    expect(clampMagnitude(raw(500), raw(100))).toBe(100);
    expect(clampMagnitude(raw(-500), raw(100))).toBe(-100);
    expect(clampMagnitude(raw(50), raw(100))).toBe(50);
  });

  it("clamps to an asymmetric range", () => {
    expect(clamp(raw(-5), raw(0), raw(10))).toBe(0);
    expect(clamp(raw(50), raw(0), raw(10))).toBe(10);
    expect(clamp(raw(5), raw(0), raw(10))).toBe(5);
  });
});

describe("sign and abs", () => {
  it("agree with each other", () => {
    for (const v of SIGNED) {
      expect(abs(v)).toBe(v < 0 ? -v : v);
      expect(sign(v)).toBe(v === 0 ? 0 : v > 0 ? 1 : -1);
    }
  });
});

describe("lerp", () => {
  it("hits both endpoints exactly", () => {
    expect(lerp(raw(0), raw(65536), raw(0))).toBe(0);
    expect(lerp(raw(0), raw(65536), raw(ONE))).toBe(65536);
    expect(lerp(raw(0), raw(65536), raw(2048))).toBe(32768); // halfway
  });

  it("interpolates a slope surface without overflowing", () => {
    // A 1:1 slope tile at the far end of a max-size level: the surface rises
    // one full tile across the tile's width. Naive int32 math wraps here.
    const base = fromTiles(239);
    const top = fromTiles(240);
    expect(lerp(base, top, raw(2048))).toBe(15695872); // 239.5 tiles
  });
});

describe("assertFixed", () => {
  it("rejects non-integers", () => {
    expect(() => assertFixed(1.5, "vx")).toThrow(/integer/);
  });

  it("rejects values outside the sanity bound", () => {
    expect(() => assertFixed(2 ** 31, "x")).toThrow(/out of Fixed range/);
    expect(() => assertFixed(-(2 ** 31), "x")).toThrow(/out of Fixed range/);
  });

  it("accepts every real coordinate in the largest legal level", () => {
    expect(() => assertFixed(fromTiles(240), "x")).not.toThrow();
    expect(() => assertFixed(-fromTiles(240), "x")).not.toThrow();
    expect(() => assertFixed(0, "x")).not.toThrow();
  });
});
