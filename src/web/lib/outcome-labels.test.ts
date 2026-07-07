import { describe, expect, it } from "vitest";
import { isCurrentlyWinning, ruleSatisfied, winningLabel } from "./outcome-labels";
import type { FixtureStats, QuestionRule } from "./types";

const winnerRule: QuestionRule = {
  statKey1: "home.full_time.goals",
  statKey2: "away.full_time.goals",
  period: "full_time",
  operator: "subtract",
  comparison: "greater_than",
  threshold: 0,
  benchmarkValue: null,
};

const benchmarkRule: QuestionRule = {
  statKey1: "home.full_time.corners",
  statKey2: "benchmark",
  period: "full_time",
  operator: "subtract",
  comparison: "greater_than",
  threshold: null,
  benchmarkValue: 5,
};

function stats(home: Partial<Record<string, number>>, away: Partial<Record<string, number>>): FixtureStats {
  return {
    full_time: {
      home: { goals: 0, yellowCards: 0, redCards: 0, corners: 0, ...home },
      away: { goals: 0, yellowCards: 0, redCards: 0, corners: 0, ...away },
    },
  };
}

describe("ruleSatisfied", () => {
  it("is true when home leads on goals", () => {
    expect(ruleSatisfied(winnerRule, stats({ goals: 2 }, { goals: 1 }))).toBe(true);
  });

  it("is false when tied", () => {
    expect(ruleSatisfied(winnerRule, stats({ goals: 1 }, { goals: 1 }))).toBe(false);
  });

  it("compares against the stored benchmark value", () => {
    expect(ruleSatisfied(benchmarkRule, stats({ corners: 6 }, {}))).toBe(true);
    expect(ruleSatisfied(benchmarkRule, stats({ corners: 4 }, {}))).toBe(false);
  });
});

describe("isCurrentlyWinning", () => {
  it("a yes pick wins when the rule holds", () => {
    expect(isCurrentlyWinning("yes", winnerRule, stats({ goals: 2 }, { goals: 0 }))).toBe(true);
  });

  it("a no pick wins when the rule does not hold", () => {
    expect(isCurrentlyWinning("no", winnerRule, stats({ goals: 0 }, { goals: 0 }))).toBe(true);
  });

  it("a higher pick loses when the rule does not hold", () => {
    expect(isCurrentlyWinning("higher", benchmarkRule, stats({ corners: 1 }, {}))).toBe(false);
  });
});

describe("winningLabel", () => {
  it("uses text, never colour, to convey state", () => {
    expect(winningLabel(true)).toBe("Ahead");
    expect(winningLabel(false)).toBe("Behind");
  });
});
