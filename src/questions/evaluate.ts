import type { FixtureStats, FixturePeriodKey, FixtureTeamStats } from "../db/schema";
import { TEMPLATE_OUTCOMES } from "./templates";
import type { TemplateId } from "./types";

/**
 * Pure outcome evaluation (issue 9, "Settlement and scoring"): given a
 * question's rule fields and its fixture's current `stats` jsonb, decides
 * the result. No DB, no chain — see settle.ts for the orchestration that
 * calls this and turns "not_ready" into a scheduled retry.
 *
 * statKey format is "<side>.<period>.<stat>" (see templates.ts). "benchmark"
 * as a side is the sentinel meaning "compare statKey1's value against the
 * rule's stored benchmarkValue instead of a second live stat".
 *
 * Void is not evaluated here: fixtureEventTransition (scheduler.ts) treats
 * "live" as a pre-live status, so a fixture going postponed/cancelled/
 * abandoned while its questions are "live" converts them straight to
 * "void" before they ever reach "settling". By the time a question is
 * settling, its fixture is already "finished" — this function is never
 * asked to evaluate a void fixture, so there is no void branch here.
 */

export type EvaluateRule = {
  statKey1: string;
  statKey2: string;
  operator: "add" | "subtract";
  comparison: "equal" | "greater_than" | "less_than";
  threshold: number | null;
  benchmarkValue: number | null;
};

export type EvaluateResult =
  | { status: "ready"; result: "yes" | "no" | "higher" | "lower" | "push" }
  | { status: "not_ready" };

function parseStatKey(key: string): { side: string; period: FixturePeriodKey; stat: keyof FixtureTeamStats } {
  const [side = "", period, stat] = key.split(".");
  return { side, period: period as FixturePeriodKey, stat: stat as keyof FixtureTeamStats };
}

function statValue(stats: FixtureStats, key: string): number | undefined {
  const { side, period, stat } = parseStatKey(key);
  const periodStats = stats[period];
  if (!periodStats) return undefined;
  if (side === "total") {
    return periodStats.home[stat] + periodStats.away[stat];
  }
  if (side === "home" || side === "away") {
    return periodStats[side][stat];
  }
  return undefined;
}

function operandValue(stats: FixtureStats, rule: EvaluateRule, key: string): number | undefined {
  if (key === "benchmark") {
    return rule.benchmarkValue ?? undefined;
  }
  return statValue(stats, key);
}

function applyComparison(diff: number, comparison: EvaluateRule["comparison"], threshold: number): boolean {
  if (comparison === "equal") return diff === threshold;
  if (comparison === "greater_than") return diff > threshold;
  return diff < threshold;
}

export function evaluateQuestion(
  templateId: TemplateId,
  rule: EvaluateRule,
  stats: FixtureStats,
): EvaluateResult {
  const value1 = operandValue(stats, rule, rule.statKey1);
  const value2 = operandValue(stats, rule, rule.statKey2);
  if (value1 === undefined || value2 === undefined) {
    return { status: "not_ready" };
  }

  const diff = rule.operator === "add" ? value1 + value2 : value1 - value2;
  // Templates with a proven benchmark but no sentinel operand (e.g.
  // corners_inter_benchmark) store the comparison anchor in benchmark_value
  // with threshold left null. When "benchmark" is already an operand (e.g.
  // team_goals_inter_benchmark), it's been consumed above, so the anchor is
  // a plain threshold (defaulting to 0).
  const usesBenchmarkAsOperand = rule.statKey1 === "benchmark" || rule.statKey2 === "benchmark";
  const anchor = rule.threshold ?? (usesBenchmarkAsOperand ? 0 : rule.benchmarkValue ?? 0);
  const outcomes = TEMPLATE_OUTCOMES[templateId];
  const isHigherLower = outcomes[0] === "higher";

  if (isHigherLower) {
    // "equal totals settle as Push" applies to Higher/Lower templates only
    // — an exact tie against the anchor is a push regardless of the stored
    // comparison direction.
    if (diff === anchor) return { status: "ready", result: "push" };
    const holds = applyComparison(diff, rule.comparison, anchor);
    return { status: "ready", result: holds ? "higher" : "lower" };
  }

  const holds = applyComparison(diff, rule.comparison, anchor);
  return { status: "ready", result: holds ? "yes" : "no" };
}
