// Shared types for question generation, the template registry, the LLM
// selector, and the lifecycle scheduler. See worldcup-hilo-hackathon-research.md
// "Priority 1: Gamification system" for the spec these implement.

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

/** Everything a template needs to render one question for one fixture. */
export type GenerationContext = {
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  benchmarkFixture?: BenchmarkFixtureInfo | null;
  teamBenchmark?: TeamBenchmarkInfo | null;
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
  | "red_cards_intra";

export type BuiltQuestion = {
  templateId: TemplateId;
  tier: TemplateTier;
  wordingVariant: number;
  rule: RuleFields;
  copy: RenderedCopy;
};
