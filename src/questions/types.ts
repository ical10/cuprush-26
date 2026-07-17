// Shared types for question generation, the template registry, the LLM
// selector, and the lifecycle scheduler. See worldcup-hilo-hackathon-research.md
// "Priority 1: Gamification system" for the spec these implement.

import type { LastMatchesAverage } from "./benchmarks";

export type Side = "home" | "away";

/** Proven benchmark from a completed *other* fixture, used by corners_inter_benchmark. */
export type BenchmarkFixtureInfo = {
  fixtureId: string;
  /** Total corners (home + away, full_time) for that completed fixture. */
  totalCorners: number;
};

/**
 * Proven benchmark from one team's own previous completed match, used by
 * team_goals_inter_benchmark. `side` is which side of *this* fixture that
 * team plays.
 */
export type TeamBenchmarkInfo = {
  fixtureId: string;
  side: Side;
  goals: number;
};

/**
 * Aggregate benchmarks over the last 10 finished fixtures, used by the
 * `*_last10` higher/lower templates. Each metric is null when fewer than the
 * minimum sample of finished fixtures with full_time stats exist (see
 * src/questions/benchmarks.ts).
 */
export type LastTenAggregates = {
  totalGoals: LastMatchesAverage | null;
  totalCorners: LastMatchesAverage | null;
  totalYellowCards: LastMatchesAverage | null;
};

/** Each team's own last-10 goals average, used by the `team_goals_last10_*` templates. */
export type TeamLastTenAggregates = {
  home: LastMatchesAverage | null;
  away: LastMatchesAverage | null;
};

/** Everything a template needs to render one question for one fixture. */
export type GenerationContext = {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  benchmarkFixture?: BenchmarkFixtureInfo | null;
  teamBenchmark?: TeamBenchmarkInfo | null;
  lastTen?: LastTenAggregates | null;
  teamLastTen?: TeamLastTenAggregates | null;
};

export type Operator = "add" | "subtract";
export type Comparison = "equal" | "greater_than" | "less_than";

export type RuleFields = {
  statKey1: string;
  statKey2: string;
  period: string | null;
  operator: Operator;
  comparison: Comparison;
  threshold: number | null;
  benchmarkFixtureId: string | null;
  benchmarkValue: number | null;
};

export type RenderedCopy = {
  question: string;
  outcomes: readonly string[];
};

export type TemplateTier = "primary" | "intra" | "inter";

export type TemplateId =
  | "winner"
  | "corners_intra"
  | "corners_inter_benchmark"
  | "period_corners_intra"
  | "goals_exact_margin"
  | "team_goals_inter_benchmark"
  | "yellow_cards_intra"
  | "red_cards_intra"
  | "total_goals_last10"
  | "total_corners_last10"
  | "total_yellow_cards_last10"
  | "team_goals_last10_home"
  | "team_goals_last10_away"
  | "period_goals_intra"
  | "red_card_occurrence";

export type BuiltQuestion = {
  templateId: TemplateId;
  tier: TemplateTier;
  wordingVariant: number;
  rule: RuleFields;
  copy: RenderedCopy;
};
