import { deterministicSeed, seededBool, seededInt } from "./seed";
import type {
  BuiltQuestion,
  GenerationContext,
  RenderedCopy,
  RuleFields,
  Side,
  TemplateId,
  TemplateTier,
} from "./types";

/**
 * Verified question template registry (typed, data-driven).
 *
 * Each template knows its own stat keys, operator, comparison, and
 * threshold/benchmark requirement, and renders human copy. Team order and
 * any per-template random choice (e.g. the exact-margin threshold) are
 * derived from a stable seed of (fixture id, template id) — see
 * src/questions/seed.ts — so regenerating a fixture's questions, or
 * retrying the LLM selector (issue 5), always yields the identical rule.
 *
 * statKey encoding: "<side>.<period>.<stat>" where side is "home" | "away" |
 * "total" | "benchmark" ("benchmark" is a sentinel meaning "compare against
 * the stored benchmark_value, not a second live stat"), period is one of
 * fixtures.stats' period keys, and stat is a FixtureTeamStats field name.
 */

export interface TemplateDefinition {
  id: TemplateId;
  tier: TemplateTier;
  wordingVariantCount: number;
  isAvailable(ctx: GenerationContext): boolean;
  build(ctx: GenerationContext, wordingVariant?: number): BuiltQuestion;
}

const STAT_LABEL = {
  goals: "goals",
  yellowCards: "yellow cards",
  redCards: "red cards",
  corners: "corners",
} as const;

function opponent(side: Side): Side {
  return side === "home" ? "away" : "home";
}

function teamName(ctx: GenerationContext, side: Side): string {
  return side === "home" ? ctx.homeTeam : ctx.awayTeam;
}

/** Deterministic (first, second) team order for one template on one fixture. */
function teamOrder(ctx: GenerationContext, templateId: TemplateId): [Side, Side] {
  const seed = deterministicSeed(ctx.fixtureId, templateId);
  const first: Side = seededBool(seed) ? "home" : "away";
  return [first, opponent(first)];
}

function hasAnyBenchmark(ctx: GenerationContext): boolean {
  return Boolean(ctx.benchmarkFixture) || Boolean(ctx.teamBenchmark);
}

// --- winner ------------------------------------------------------------

const winner: TemplateDefinition = {
  id: "winner",
  tier: "primary",
  wordingVariantCount: 1,
  isAvailable: () => true,
  build(ctx) {
    const [first, second] = teamOrder(ctx, "winner");
    const rule: RuleFields = {
      statKey1: `${first}.full_time.goals`,
      statKey2: `${second}.full_time.goals`,
      period: "full_time",
      operator: "subtract",
      comparison: "greater_than",
      threshold: 0,
      benchmarkFixtureId: null,
      benchmarkValue: null,
    };
    const copy: RenderedCopy = {
      question: `Will ${teamName(ctx, first)} score more goals than ${teamName(ctx, second)}?`,
      outcomes: ["Yes", "No"],
    };
    return { templateId: "winner", tier: "primary", wordingVariant: 0, rule, copy };
  },
};

// --- intra-fixture two-stat comparisons ---------------------------------

function intraStatComparison(
  id: TemplateId,
  stat: "corners" | "yellowCards" | "redCards",
  options: { isAvailable?: (ctx: GenerationContext) => boolean } = {},
): TemplateDefinition {
  return {
    id,
    tier: "intra",
    wordingVariantCount: 2,
    isAvailable: options.isAvailable ?? (() => true),
    build(ctx, wordingVariant = 0) {
      const [first, second] = teamOrder(ctx, id);
      const rule: RuleFields = {
        statKey1: `${first}.full_time.${stat}`,
        statKey2: `${second}.full_time.${stat}`,
        period: "full_time",
        operator: "subtract",
        comparison: "greater_than",
        threshold: 0,
        benchmarkFixtureId: null,
        benchmarkValue: null,
      };
      const label = STAT_LABEL[stat];
      const question =
        wordingVariant === 1
          ? `Will ${teamName(ctx, first)} win the ${label} count against ${teamName(ctx, second)}?`
          : `Will ${teamName(ctx, first)} have more ${label} than ${teamName(ctx, second)}?`;
      const copy: RenderedCopy = { question, outcomes: ["Higher", "Lower"] };
      return { templateId: id, tier: "intra", wordingVariant, rule, copy };
    },
  };
}

const cornersIntra = intraStatComparison("corners_intra", "corners");

// "Add yellow-card questions when the matchup has a clear benchmark" — any
// proven benchmark (inter-fixture or team) is enough signal.
const yellowCardsIntra = intraStatComparison("yellow_cards_intra", "yellowCards", {
  isAvailable: hasAnyBenchmark,
});

// "Use red cards sparingly because most questions would have a zero
// benchmark" — gated stricter than yellow (both benchmark kinds must be
// present), so it only surfaces for the rare fixture with rich benchmark
// data, never merely because *a* benchmark exists.
const redCardsIntra = intraStatComparison("red_cards_intra", "redCards", {
  isAvailable: (ctx) => Boolean(ctx.benchmarkFixture) && Boolean(ctx.teamBenchmark),
});

// --- period comparison (second half vs first half) ----------------------

const periodCornersIntra: TemplateDefinition = {
  id: "period_corners_intra",
  tier: "intra",
  wordingVariantCount: 1,
  isAvailable: () => true,
  build() {
    const rule: RuleFields = {
      statKey1: "total.second_half.corners",
      statKey2: "total.first_half.corners",
      // Two different periods are being compared — a single `period`
      // column can't represent that, so it's left null.
      period: null,
      operator: "subtract",
      comparison: "greater_than",
      threshold: 0,
      benchmarkFixtureId: null,
      benchmarkValue: null,
    };
    const copy: RenderedCopy = {
      question: "Will second-half corners beat first-half corners?",
      outcomes: ["Higher", "Lower"],
    };
    return { templateId: "period_corners_intra", tier: "intra", wordingVariant: 0, rule, copy };
  },
};

// --- exact margin ---------------------------------------------------------

const goalsExactMargin: TemplateDefinition = {
  id: "goals_exact_margin",
  tier: "intra",
  wordingVariantCount: 1,
  isAvailable: () => true,
  build(ctx) {
    const [first, second] = teamOrder(ctx, "goals_exact_margin");
    const seed = deterministicSeed(ctx.fixtureId, "goals_exact_margin", "threshold");
    const threshold = seededInt(seed, 1, 2);
    const rule: RuleFields = {
      statKey1: `${first}.full_time.goals`,
      statKey2: `${second}.full_time.goals`,
      period: "full_time",
      operator: "subtract",
      comparison: "equal",
      threshold,
      benchmarkFixtureId: null,
      benchmarkValue: null,
    };
    const copy: RenderedCopy = {
      question: `Will ${teamName(ctx, first)} score exactly ${threshold} more goal${threshold === 1 ? "" : "s"} than ${teamName(ctx, second)}?`,
      outcomes: ["Yes", "No"],
    };
    return { templateId: "goals_exact_margin", tier: "intra", wordingVariant: 0, rule, copy };
  },
};

// --- inter-fixture benchmarks ---------------------------------------------

const cornersInterBenchmark: TemplateDefinition = {
  id: "corners_inter_benchmark",
  tier: "inter",
  wordingVariantCount: 2,
  isAvailable: (ctx) => Boolean(ctx.benchmarkFixture),
  build(ctx, wordingVariant = 0) {
    const benchmark = ctx.benchmarkFixture;
    if (!benchmark) {
      throw new Error("corners_inter_benchmark: no benchmark fixture available");
    }
    const rule: RuleFields = {
      statKey1: "home.full_time.corners",
      statKey2: "away.full_time.corners",
      period: "full_time",
      operator: "add",
      comparison: "greater_than",
      threshold: null,
      benchmarkFixtureId: benchmark.fixtureId,
      benchmarkValue: benchmark.totalCorners,
    };
    const question =
      wordingVariant === 1
        ? `The last match had ${benchmark.totalCorners} corners. Will this one have more?`
        : `Previous match: ${benchmark.totalCorners} total corners. Will this match finish Higher or Lower?`;
    const copy: RenderedCopy = { question, outcomes: ["Higher", "Lower"] };
    return {
      templateId: "corners_inter_benchmark",
      tier: "inter",
      wordingVariant,
      rule,
      copy,
    };
  },
};

const teamGoalsInterBenchmark: TemplateDefinition = {
  id: "team_goals_inter_benchmark",
  tier: "inter",
  wordingVariantCount: 1,
  isAvailable: (ctx) => Boolean(ctx.teamBenchmark),
  build(ctx) {
    const benchmark = ctx.teamBenchmark;
    if (!benchmark) {
      throw new Error("team_goals_inter_benchmark: no team benchmark available");
    }
    const rule: RuleFields = {
      statKey1: `${benchmark.side}.full_time.goals`,
      // Sentinel: compare statKey1 against the stored benchmark_value, not
      // a second live stat.
      statKey2: "benchmark",
      period: "full_time",
      operator: "subtract",
      comparison: "greater_than",
      threshold: null,
      benchmarkFixtureId: benchmark.fixtureId,
      benchmarkValue: benchmark.goals,
    };
    const name = teamName(ctx, benchmark.side);
    const copy: RenderedCopy = {
      question: `Will ${name} score more goals than ${name} did last match (${benchmark.goals})?`,
      outcomes: ["Yes", "No"],
    };
    return {
      templateId: "team_goals_inter_benchmark",
      tier: "inter",
      wordingVariant: 0,
      rule,
      copy,
    };
  },
};

// --- registry ---------------------------------------------------------------

export const TEMPLATES: Record<TemplateId, TemplateDefinition> = {
  winner,
  corners_intra: cornersIntra,
  corners_inter_benchmark: cornersInterBenchmark,
  period_corners_intra: periodCornersIntra,
  goals_exact_margin: goalsExactMargin,
  team_goals_inter_benchmark: teamGoalsInterBenchmark,
  yellow_cards_intra: yellowCardsIntra,
  red_cards_intra: redCardsIntra,
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

/**
 * The outcome pair a participant may submit for each template's questions —
 * the lowercase form of each template's rendered `copy.outcomes`. The
 * prediction API validates submissions against this.
 */
export const TEMPLATE_OUTCOMES: Record<
  TemplateId,
  readonly ["yes", "no"] | readonly ["higher", "lower"]
> = {
  winner: ["yes", "no"],
  corners_intra: ["higher", "lower"],
  corners_inter_benchmark: ["higher", "lower"],
  period_corners_intra: ["higher", "lower"],
  goals_exact_margin: ["yes", "no"],
  team_goals_inter_benchmark: ["yes", "no"],
  yellow_cards_intra: ["higher", "lower"],
  red_cards_intra: ["higher", "lower"],
};

/** Allowed outcomes for a stored `questions.template` value; null if unknown. */
export function allowedOutcomes(
  templateId: string,
): readonly string[] | null {
  return (TEMPLATE_OUTCOMES as Record<string, readonly string[]>)[templateId] ?? null;
}
