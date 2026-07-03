import { describe, expect, it } from "vitest";
import { deterministicSeed, seededBool, seededInt } from "./seed";

describe("deterministicSeed", () => {
  it("is a pure function of its parts: same parts always produce the same seed", () => {
    const a = deterministicSeed("wc-2026-arg-fra", "winner");
    const b = deterministicSeed("wc-2026-arg-fra", "winner");
    expect(a).toBe(b);
  });

  it("differs when any part differs", () => {
    const winner = deterministicSeed("wc-2026-arg-fra", "winner");
    const corners = deterministicSeed("wc-2026-arg-fra", "corners");
    const otherFixture = deterministicSeed("wc-2026-bra-ger", "winner");
    expect(winner).not.toBe(corners);
    expect(winner).not.toBe(otherFixture);
  });

  it("returns a non-negative 32-bit integer", () => {
    const seed = deterministicSeed("wc-2026-arg-fra", "winner");
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("seededBool", () => {
  it("is deterministic for the same seed", () => {
    const seed = deterministicSeed("wc-2026-arg-fra", "winner");
    expect(seededBool(seed)).toBe(seededBool(seed));
  });

  it("produces both true and false across a range of seeds", () => {
    const results = new Set(Array.from({ length: 50 }, (_, i) => seededBool(i)));
    expect(results.has(true)).toBe(true);
    expect(results.has(false)).toBe(true);
  });
});

describe("seededInt", () => {
  it("stays within the inclusive [min, max] range across many seeds", () => {
    for (let i = 0; i < 200; i++) {
      const value = seededInt(i, 1, 3);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(3);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("is deterministic for the same seed", () => {
    const seed = deterministicSeed("wc-2026-arg-fra", "exact_margin");
    expect(seededInt(seed, 1, 5)).toBe(seededInt(seed, 1, 5));
  });

  it("can return the single value when min === max", () => {
    expect(seededInt(42, 7, 7)).toBe(7);
  });
});

