import { describe, expect, it } from "vitest";
import type { FixtureStats } from "../db/schema";
import { evaluateQuestion, type EvaluateRule } from "./evaluate";

function teamStats(goals = 0, yellowCards = 0, redCards = 0, corners = 0) {
  return { goals, yellowCards, redCards, corners };
}

describe("evaluateQuestion", () => {
  describe("winner (yes/no)", () => {
    const rule: EvaluateRule = {
      statKey1: "home.full_time.goals",
      statKey2: "away.full_time.goals",
      operator: "subtract",
      comparison: "greater_than",
      threshold: 0,
      benchmarkValue: null,
    };

    it("yes when home scores more", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(2), away: teamStats(1) } };
      expect(evaluateQuestion("winner", rule, stats)).toEqual({ status: "ready", result: "yes" });
    });

    it("no when home scores fewer or equal", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(1), away: teamStats(1) } };
      expect(evaluateQuestion("winner", rule, stats)).toEqual({ status: "ready", result: "no" });
    });

    it("not_ready when full_time stats are missing", () => {
      expect(evaluateQuestion("winner", rule, {})).toEqual({ status: "not_ready" });
    });
  });

  describe("goals_exact_margin (yes/no)", () => {
    const rule: EvaluateRule = {
      statKey1: "home.full_time.goals",
      statKey2: "away.full_time.goals",
      operator: "subtract",
      comparison: "equal",
      threshold: 2,
      benchmarkValue: null,
    };

    it("yes on exact margin", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(3), away: teamStats(1) } };
      expect(evaluateQuestion("goals_exact_margin", rule, stats)).toEqual({
        status: "ready",
        result: "yes",
      });
    });

    it("no on a different margin (including a tie — no push semantics here)", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(1), away: teamStats(1) } };
      expect(evaluateQuestion("goals_exact_margin", rule, stats)).toEqual({
        status: "ready",
        result: "no",
      });
    });
  });

  describe("team_goals_inter_benchmark (yes/no, sentinel statKey2)", () => {
    const rule: EvaluateRule = {
      statKey1: "home.full_time.goals",
      statKey2: "benchmark",
      operator: "subtract",
      comparison: "greater_than",
      threshold: null,
      benchmarkValue: 2,
    };

    it("yes when the team beats its own benchmark", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(3), away: teamStats(0) } };
      expect(evaluateQuestion("team_goals_inter_benchmark", rule, stats)).toEqual({
        status: "ready",
        result: "yes",
      });
    });

    it("no when the team doesn't beat its own benchmark", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(2), away: teamStats(0) } };
      expect(evaluateQuestion("team_goals_inter_benchmark", rule, stats)).toEqual({
        status: "ready",
        result: "no",
      });
    });
  });

  describe("corners_intra (higher/lower/push)", () => {
    const rule: EvaluateRule = {
      statKey1: "home.full_time.corners",
      statKey2: "away.full_time.corners",
      operator: "subtract",
      comparison: "greater_than",
      threshold: 0,
      benchmarkValue: null,
    };

    it("higher", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(0, 0, 0, 6), away: teamStats(0, 0, 0, 4) } };
      expect(evaluateQuestion("corners_intra", rule, stats)).toEqual({ status: "ready", result: "higher" });
    });

    it("lower", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(0, 0, 0, 3), away: teamStats(0, 0, 0, 4) } };
      expect(evaluateQuestion("corners_intra", rule, stats)).toEqual({ status: "ready", result: "lower" });
    });

    it("push on an exact tie", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(0, 0, 0, 5), away: teamStats(0, 0, 0, 5) } };
      expect(evaluateQuestion("corners_intra", rule, stats)).toEqual({ status: "ready", result: "push" });
    });

    it("not_ready when stats are missing", () => {
      expect(evaluateQuestion("corners_intra", rule, {})).toEqual({ status: "not_ready" });
    });
  });

  describe("period_corners_intra (higher/lower/push, cross-period)", () => {
    const rule: EvaluateRule = {
      statKey1: "total.second_half.corners",
      statKey2: "total.first_half.corners",
      operator: "subtract",
      comparison: "greater_than",
      threshold: 0,
      benchmarkValue: null,
    };

    it("higher when second half has more corners", () => {
      const stats: FixtureStats = {
        first_half: { home: teamStats(0, 0, 0, 2), away: teamStats(0, 0, 0, 1) },
        second_half: { home: teamStats(0, 0, 0, 3), away: teamStats(0, 0, 0, 3) },
      };
      expect(evaluateQuestion("period_corners_intra", rule, stats)).toEqual({
        status: "ready",
        result: "higher",
      });
    });

    it("not_ready when second half hasn't happened yet", () => {
      const stats: FixtureStats = {
        first_half: { home: teamStats(0, 0, 0, 2), away: teamStats(0, 0, 0, 1) },
      };
      expect(evaluateQuestion("period_corners_intra", rule, stats)).toEqual({ status: "not_ready" });
    });
  });

  describe("corners_inter_benchmark (higher/lower/push, sentinel-free add + benchmark)", () => {
    const rule: EvaluateRule = {
      statKey1: "home.full_time.corners",
      statKey2: "away.full_time.corners",
      operator: "add",
      comparison: "greater_than",
      threshold: null,
      benchmarkValue: 9,
    };

    it("higher when total corners beat the benchmark", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(0, 0, 0, 6), away: teamStats(0, 0, 0, 5) } };
      expect(evaluateQuestion("corners_inter_benchmark", rule, stats)).toEqual({
        status: "ready",
        result: "higher",
      });
    });

    it("push when total corners exactly match the benchmark", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(0, 0, 0, 5), away: teamStats(0, 0, 0, 4) } };
      expect(evaluateQuestion("corners_inter_benchmark", rule, stats)).toEqual({
        status: "ready",
        result: "push",
      });
    });

    it("lower when total corners fall short of the benchmark", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(0, 0, 0, 3), away: teamStats(0, 0, 0, 4) } };
      expect(evaluateQuestion("corners_inter_benchmark", rule, stats)).toEqual({
        status: "ready",
        result: "lower",
      });
    });
  });

  describe("total_goals_last10 (higher/lower/push, aggregate benchmark)", () => {
    const rule: EvaluateRule = {
      statKey1: "home.full_time.goals",
      statKey2: "away.full_time.goals",
      operator: "add",
      comparison: "greater_than",
      threshold: null,
      benchmarkValue: 3,
    };

    it("higher when total goals beat the last-10 average", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(2), away: teamStats(2) } };
      expect(evaluateQuestion("total_goals_last10", rule, stats)).toEqual({
        status: "ready",
        result: "higher",
      });
    });

    it("lower when total goals fall short of the last-10 average", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(1), away: teamStats(1) } };
      expect(evaluateQuestion("total_goals_last10", rule, stats)).toEqual({
        status: "ready",
        result: "lower",
      });
    });

    it("push on an exact tie with the last-10 average", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(2), away: teamStats(1) } };
      expect(evaluateQuestion("total_goals_last10", rule, stats)).toEqual({
        status: "ready",
        result: "push",
      });
    });
  });

  describe("red_card_occurrence (yes/no, constant-0 benchmark operand)", () => {
    const rule: EvaluateRule = {
      statKey1: "total.full_time.redCards",
      statKey2: "benchmark",
      operator: "subtract",
      comparison: "greater_than",
      threshold: null,
      benchmarkValue: 0,
    };

    it("yes when any red card was shown", () => {
      const stats: FixtureStats = {
        full_time: { home: teamStats(0, 0, 1), away: teamStats(0, 0, 0) },
      };
      expect(evaluateQuestion("red_card_occurrence", rule, stats)).toEqual({
        status: "ready",
        result: "yes",
      });
    });

    it("no when no red card was shown", () => {
      const stats: FixtureStats = {
        full_time: { home: teamStats(0, 0, 0), away: teamStats(0, 0, 0) },
      };
      expect(evaluateQuestion("red_card_occurrence", rule, stats)).toEqual({
        status: "ready",
        result: "no",
      });
    });
  });

  describe("yellow_cards_intra / red_cards_intra (higher/lower/push)", () => {
    const rule: EvaluateRule = {
      statKey1: "home.full_time.yellowCards",
      statKey2: "away.full_time.yellowCards",
      operator: "subtract",
      comparison: "greater_than",
      threshold: 0,
      benchmarkValue: null,
    };

    it("push when yellow cards tie", () => {
      const stats: FixtureStats = { full_time: { home: teamStats(0, 2), away: teamStats(0, 2) } };
      expect(evaluateQuestion("yellow_cards_intra", rule, stats)).toEqual({
        status: "ready",
        result: "push",
      });
    });

    it("higher/lower for red cards mirrors the same rule shape", () => {
      const redRule: EvaluateRule = {
        statKey1: "home.full_time.redCards",
        statKey2: "away.full_time.redCards",
        operator: "subtract",
        comparison: "greater_than",
        threshold: 0,
        benchmarkValue: null,
      };
      const stats: FixtureStats = { full_time: { home: teamStats(0, 0, 1), away: teamStats(0, 0, 0) } };
      expect(evaluateQuestion("red_cards_intra", redRule, stats)).toEqual({
        status: "ready",
        result: "higher",
      });
    });
  });
});
