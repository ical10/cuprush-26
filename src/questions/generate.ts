import { and, desc, eq, lt, or } from "drizzle-orm";
import type { Database } from "../db/client";
import { fixtures, questions, type FixtureStage } from "../db/schema";
import { computeRuleHash } from "./rule-hash";
import { HARD_CAP_TOTAL_CARDS, secondaryBudget } from "./stage-budget";
import { TEMPLATES } from "./templates";
import type { BuiltQuestion, GenerationContext, TemplateId } from "./types";

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;

/**
 * Secondary card priority, most preferred first. Each category tries its
 * template ids in order and takes the first one whose `isAvailable(ctx)` is
 * true — this is where "inter-fixture benchmark, else intra-fixture
 * fallback" happens. See worldcup-hilo-hackathon-research.md, "Question
 * rotation": corners/goals preferred first, yellow only with a clear
 * benchmark, red sparingly.
 */
export const SECONDARY_CATEGORIES: { category: string; templateIds: TemplateId[] }[] = [
  { category: "corners", templateIds: ["corners_inter_benchmark", "corners_intra"] },
  { category: "yellow_cards", templateIds: ["yellow_cards_intra"] },
  { category: "red_cards", templateIds: ["red_cards_intra"] },
  { category: "goals_margin", templateIds: ["goals_exact_margin"] },
  { category: "period_corners", templateIds: ["period_corners_intra"] },
  { category: "team_goals_benchmark", templateIds: ["team_goals_inter_benchmark"] },
];

/**
 * The deterministic (non-LLM) secondary card selection: walks
 * SECONDARY_CATEGORIES in priority order, picks the first available
 * template id per category, and stops at `budget` or the hard cap. This is
 * both the issue-4 generation path and the issue-5 LLM selector's fallback
 * when the LLM is disabled, times out, or returns an invalid rule — see
 * src/questions/llm-selector.ts.
 */
export function selectDeterministicSecondaries(
  ctx: GenerationContext,
  budget: number,
): BuiltQuestion[] {
  const secondaries: BuiltQuestion[] = [];

  for (const { templateIds } of SECONDARY_CATEGORIES) {
    if (secondaries.length >= budget) break;
    if (secondaries.length + 1 >= HARD_CAP_TOTAL_CARDS) break;

    const templateId = templateIds.find((id) => TEMPLATES[id].isAvailable(ctx));
    if (!templateId) continue;

    secondaries.push(TEMPLATES[templateId].build(ctx));
  }

  return secondaries;
}

/**
 * Pure, deterministic question generation for one fixture: always 1 winner
 * card, plus up to `secondaryBudget(stage)` secondary cards chosen by
 * priority, capped at HARD_CAP_TOTAL_CARDS overall. Same context + stage
 * always returns the identical list (see src/questions/seed.ts) — safe to
 * call repeatedly.
 */
export function generateQuestionRules(
  ctx: GenerationContext,
  stage: FixtureStage,
): BuiltQuestion[] {
  const budget = secondaryBudget(stage);
  return [TEMPLATES.winner.build(ctx), ...selectDeterministicSecondaries(ctx, budget)];
}

// --- persistence ------------------------------------------------------------

export type FixtureRow = typeof fixtures.$inferSelect;

function totalCorners(fixture: FixtureRow): number | null {
  const fullTime = fixture.stats.full_time;
  if (!fullTime) return null;
  return fullTime.home.corners + fullTime.away.corners;
}

/** The most recently completed *other* fixture, any teams — "the previous match". */
async function findBenchmarkFixture(db: Database, before: FixtureRow) {
  const [row] = await db
    .select()
    .from(fixtures)
    .where(and(eq(fixtures.gameState, "finished"), lt(fixtures.startsAt, before.startsAt)))
    .orderBy(desc(fixtures.startsAt))
    .limit(1);
  if (!row) return null;
  const corners = totalCorners(row);
  if (corners === null) return null;
  return { fixtureId: row.id, totalCorners: corners };
}

async function findTeamBenchmark(db: Database, current: FixtureRow) {
  for (const [team, side] of [
    [current.homeTeam, "home"],
    [current.awayTeam, "away"],
  ] as const) {
    const [row] = await db
      .select()
      .from(fixtures)
      .where(
        and(
          eq(fixtures.gameState, "finished"),
          lt(fixtures.startsAt, current.startsAt),
          or(eq(fixtures.homeTeam, team), eq(fixtures.awayTeam, team)),
        ),
      )
      .orderBy(desc(fixtures.startsAt))
      .limit(1);
    if (!row) continue;
    const fullTime = row.stats.full_time;
    if (!fullTime) continue;
    const goals = row.homeTeam === team ? fullTime.home.goals : fullTime.away.goals;
    return { fixtureId: row.id, side, goals };
  }
  return null;
}

/**
 * Resolves a fixture's generation context from the database: the most
 * recently completed *other* fixture (for the total-corners benchmark) and
 * either team's most recent completed match (for the team-goals benchmark).
 */
export async function resolveGenerationContext(
  db: Database,
  fixture: FixtureRow,
): Promise<GenerationContext> {
  const [benchmarkFixture, teamBenchmark] = await Promise.all([
    findBenchmarkFixture(db, fixture),
    findTeamBenchmark(db, fixture),
  ]);

  return {
    fixtureId: fixture.id,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    benchmarkFixture,
    teamBenchmark,
  };
}

function toInsertRow(fixture: FixtureRow, built: BuiltQuestion) {
  const opensAt = new Date(fixture.startsAt.getTime() - SIX_HOURS_MS);
  const locksAt = new Date(fixture.startsAt.getTime() - THIRTY_MINUTES_MS);

  return {
    fixtureId: fixture.id,
    benchmarkFixtureId: built.rule.benchmarkFixtureId,
    template: built.templateId,
    statKey1: built.rule.statKey1,
    statKey2: built.rule.statKey2,
    period: built.rule.period,
    operator: built.rule.operator,
    comparison: built.rule.comparison,
    threshold: built.rule.threshold,
    benchmarkValue: built.rule.benchmarkValue,
    opensAt,
    locksAt,
    ruleHash: computeRuleHash({
      fixtureId: fixture.id,
      benchmarkFixtureId: built.rule.benchmarkFixtureId,
      statKey1: built.rule.statKey1,
      statKey2: built.rule.statKey2,
      operator: built.rule.operator,
      comparison: built.rule.comparison,
      threshold: built.rule.threshold,
    }),
  };
}

export type GenerateQuestionsResult = {
  attempted: number;
  inserted: (typeof questions.$inferSelect)[];
};

/**
 * Persists an already-selected rule list (from either the deterministic
 * path or the LLM selector — see src/questions/llm-selector.ts) for one
 * fixture. Idempotent: the canonical rule hash is unique per question, so
 * persisting the same fixture's rules again (e.g. the scheduler re-running
 * after generation already happened) inserts nothing new —
 * `onConflictDoNothing` silently skips already-existing rows instead of
 * erroring.
 */
export async function persistGeneratedQuestions(
  db: Database,
  fixture: FixtureRow,
  rules: BuiltQuestion[],
): Promise<GenerateQuestionsResult> {
  const rows = rules.map((built) => toInsertRow(fixture, built));

  const inserted = await db
    .insert(questions)
    .values(rows)
    .onConflictDoNothing({ target: questions.ruleHash })
    .returning();

  return { attempted: rows.length, inserted };
}

/** Generates (deterministically, no LLM) and persists questions for one fixture. */
export async function generateQuestionsForFixture(
  db: Database,
  fixtureId: string,
): Promise<GenerateQuestionsResult> {
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  if (!fixture) {
    throw new Error(`generateQuestionsForFixture: unknown fixture ${fixtureId}`);
  }

  const ctx = await resolveGenerationContext(db, fixture);
  const rules = generateQuestionRules(ctx, fixture.stage);
  return persistGeneratedQuestions(db, fixture, rules);
}
