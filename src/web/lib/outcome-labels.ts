import type { FixtureStats, FixturePeriodKey, FixtureTeamStats, QuestionRule } from "./types";

const BENCHMARK_KEY = "benchmark";

function parseStatKey(key: string): { side: string; period: FixturePeriodKey; stat: keyof FixtureTeamStats } {
  const [side = "", period, stat] = key.split(".");
  return { side, period: period as FixturePeriodKey, stat: stat as keyof FixtureTeamStats };
}

function liveStatValue(stats: FixtureStats, key: string): number {
  const { side, period, stat } = parseStatKey(key);
  const periodStats = stats[period];
  if (!periodStats) return 0;
  if (side === "total") return periodStats.home[stat] + periodStats.away[stat];
  if (side === "home" || side === "away") return periodStats[side][stat];
  return 0;
}

/**
 * Mirrors src/questions/evaluate.ts's operand resolution (server source of
 * truth for settlement): "benchmark" as a statKey is a sentinel for the
 * question's stored benchmarkValue, not a second live stat.
 */
function operandValue(rule: QuestionRule, stats: FixtureStats, key: string): number {
  if (key === BENCHMARK_KEY) return rule.benchmarkValue ?? 0;
  return liveStatValue(stats, key);
}

/** Left-hand display value: the question's own tracked stat. */
export function ruleStat1(rule: QuestionRule, stats: FixtureStats): number {
  return operandValue(rule, stats, rule.statKey1);
}

/** Right-hand display value: the opposing stat, or the proven benchmark. */
export function ruleStat2(rule: QuestionRule, stats: FixtureStats): number {
  return operandValue(rule, stats, rule.statKey2);
}

/**
 * Whether the rule's comparison currently holds, given live stat totals.
 * Mirrors src/questions/evaluate.ts's diff/anchor derivation exactly, so
 * the live "winning/losing" label always agrees with eventual settlement.
 */
export function ruleSatisfied(rule: QuestionRule, stats: FixtureStats): boolean {
  const value1 = operandValue(rule, stats, rule.statKey1);
  const value2 = operandValue(rule, stats, rule.statKey2);
  const diff = rule.operator === "add" ? value1 + value2 : value1 - value2;

  const usesBenchmarkAsOperand =
    rule.statKey1 === BENCHMARK_KEY || rule.statKey2 === BENCHMARK_KEY;
  const anchor = rule.threshold ?? (usesBenchmarkAsOperand ? 0 : rule.benchmarkValue ?? 0);

  switch (rule.comparison) {
    case "equal":
      return diff === anchor;
    case "greater_than":
      return diff > anchor;
    case "less_than":
      return diff < anchor;
    default:
      return false;
  }
}

/**
 * Whether a saved "yes"/"higher" outcome is currently the winning side.
 * "no"/"lower" wins exactly when the rule is *not* satisfied. Returns a
 * plain boolean — the label shown for it is always text, never colour.
 */
export function isCurrentlyWinning(
  outcome: string,
  rule: QuestionRule,
  stats: FixtureStats,
): boolean {
  const satisfied = ruleSatisfied(rule, stats);
  return outcome === "yes" || outcome === "higher" ? satisfied : !satisfied;
}

/** DESIGN.md § 05 "Live card": the word sits beside the arrow, never color alone. */
export function winningLabel(winning: boolean): string {
  return winning ? "Ahead" : "Behind";
}

/** Display-only: "yes" -> "Yes". The raw lowercase value is what gets submitted. */
export function capitalizeOutcome(outcome: string): string {
  return outcome ? outcome[0]!.toUpperCase() + outcome.slice(1) : outcome;
}
