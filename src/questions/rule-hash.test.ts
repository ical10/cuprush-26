import { describe, expect, it } from "vitest";
import { computeRuleHash, type CanonicalRule } from "./rule-hash";

const base: CanonicalRule = {
  fixtureId: "wc-2026-arg-fra",
  benchmarkFixtureId: null,
  statKey1: "home.full_time.goals",
  statKey2: "away.full_time.goals",
  operator: "subtract",
  comparison: "greater_than",
  threshold: 0,
};

describe("computeRuleHash", () => {
  it("is a stable function of the canonical rule fields", () => {
    expect(computeRuleHash(base)).toBe(computeRuleHash({ ...base }));
  });

  it("is a 64-character hex sha256 digest", () => {
    const hash = computeRuleHash(base);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["fixtureId", { fixtureId: "wc-2026-bra-ger" }],
    ["benchmarkFixtureId", { benchmarkFixtureId: "wc-2026-bra-ger" }],
    ["statKey1", { statKey1: "away.full_time.goals" }],
    ["statKey2", { statKey2: "home.full_time.goals" }],
    ["operator", { operator: "add" as const }],
    ["comparison", { comparison: "less_than" as const }],
    ["threshold", { threshold: 2 }],
  ])("changes when %s changes", (_label, override) => {
    expect(computeRuleHash({ ...base, ...override })).not.toBe(computeRuleHash(base));
  });

  it("is order-sensitive: swapping statKey1/statKey2 changes the hash", () => {
    const swapped: CanonicalRule = { ...base, statKey1: base.statKey2, statKey2: base.statKey1 };
    expect(computeRuleHash(swapped)).not.toBe(computeRuleHash(base));
  });

  it("treats a null and undefined benchmarkFixtureId identically", () => {
    const withUndefined: CanonicalRule = { ...base, benchmarkFixtureId: undefined };
    const withNull: CanonicalRule = { ...base, benchmarkFixtureId: null };
    expect(computeRuleHash(withUndefined)).toBe(computeRuleHash(withNull));
  });
});
