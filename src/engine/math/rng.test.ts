import { describe, expect, it } from "vitest";
import { Rng } from "./rng";

describe("Rng", () => {
  it("is reproducible from a seed, the whole reason it exists", () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 200 }, () => a.nextU32());
    const seqB = Array.from({ length: 200 }, () => b.nextU32());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = new Rng(1);
    const b = new Rng(2);
    expect(a.nextU32()).not.toBe(b.nextU32());
  });

  it("round-trips its state, so rewind restores randomness too", () => {
    // The world snapshot captures getState(); restoring it must put the
    // generator back on the exact same branch of the sequence.
    const rng = new Rng(99);
    for (let i = 0; i < 10; i++) rng.nextU32();

    const saved = rng.getState();
    const expected = Array.from({ length: 20 }, () => rng.nextU32());

    rng.setState(saved);
    const replayed = Array.from({ length: 20 }, () => rng.nextU32());
    expect(replayed).toEqual(expected);
  });

  it("stays inside the u32 range", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 5000; i++) {
      const v = rng.nextU32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(4294967295);
    }
  });

  it("respects nextInt bounds", () => {
    const rng = new Rng(4242);
    for (let i = 0; i < 5000; i++) {
      const v = rng.nextInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
    expect(rng.nextInt(0)).toBe(0);
    expect(rng.nextInt(1)).toBe(0);
  });

  it("respects nextRange bounds, inclusive at both ends", () => {
    const rng = new Rng(31337);
    let sawMin = false;
    let sawMax = false;
    for (let i = 0; i < 5000; i++) {
      const v = rng.nextRange(-3, 3);
      expect(v).toBeGreaterThanOrEqual(-3);
      expect(v).toBeLessThanOrEqual(3);
      if (v === -3) sawMin = true;
      if (v === 3) sawMax = true;
    }
    expect(sawMin && sawMax).toBe(true);
  });

  it("distributes nextInt roughly uniformly (rejection sampling, not modulo bias)", () => {
    const rng = new Rng(2024);
    const buckets = new Array(10).fill(0);
    const n = 100000;
    for (let i = 0; i < n; i++) buckets[rng.nextInt(10)]++;
    // Each bucket should hold ~10%. A modulo-biased generator over a bound that
    // does not divide 2^32 skews the low buckets; 2% of slack is far tighter
    // than that bias while staying well clear of normal sampling noise.
    for (const count of buckets) {
      expect(Math.abs(count / n - 0.1)).toBeLessThan(0.02);
    }
  });

  it("normalizes hostile seeds instead of degenerating", () => {
    // Floats and out-of-int32 values must not produce a stuck or NaN state.
    for (const seed of [0, -1, 2 ** 31, -(2 ** 31), 1.5, 2 ** 53]) {
      const rng = new Rng(seed);
      const first = rng.nextU32();
      const second = rng.nextU32();
      expect(Number.isInteger(first)).toBe(true);
      expect(first).not.toBe(second);
    }
  });
});
