import { asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { fixtures, questions, type QuestionStatus } from "../../db/schema";
import { allowedOutcomes } from "../../questions/templates";
import type { DbProvider } from "../auth/middleware";

// Guests browse before authenticating (research doc "no authentication
// wall before first card"), so this list excludes only lifecycle states a
// fan should never be asked to act on: not-yet-open and voided questions.
const VISIBLE_STATUSES: QuestionStatus[] = [
  "open",
  "locked",
  "live",
  "settling",
  "settled",
];

type QuestionRow = typeof questions.$inferSelect;
type FixtureRow = typeof fixtures.$inferSelect;

function sideAndStat(statKey: string): { side: string; stat: string } | null {
  const parts = statKey.split(".");
  const side = parts[0];
  const stat = parts.at(-1);
  if (!side || !stat) return null;
  return { side, stat };
}

const STAT_LABEL: Record<string, string> = {
  goals: "goals",
  yellowCards: "yellow cards",
  redCards: "red cards",
  corners: "corners",
};

function teamName(fixture: FixtureRow, side: string): string {
  if (side === "home") return fixture.homeTeam;
  if (side === "away") return fixture.awayTeam;
  return side;
}

/**
 * Rebuilds the human-readable question text and outcome labels from the
 * stored rule fields, so the client never needs the template registry's
 * generation-time context (team benchmarks, wording-variant seed, …) —
 * only the immutable rule already persisted on the question row. Mirrors
 * (a fixed wording variant of) src/questions/templates.ts's copy for each
 * template id.
 */
export function renderCopy(
  question: QuestionRow,
  fixture: FixtureRow,
): { text: string; outcomes: readonly string[] } {
  // Raw canonical values (e.g. "yes"/"no"), not display labels — the client
  // submits these back verbatim via POST /api/predictions, whose Zod schema
  // only accepts yes|no|higher|lower. Capitalizing here previously made
  // every submission 400, since the app used this same array as the button
  // value. Capitalization is a display-only concern; see
  // src/web/lib/outcome-labels.ts's capitalizeOutcome.
  const outcomes = allowedOutcomes(question.template) ?? ["yes", "no"];

  if (question.template === "winner") {
    const first = sideAndStat(question.statKey1);
    const second = sideAndStat(question.statKey2);
    if (first && second) {
      return {
        text: `Will ${teamName(fixture, first.side)} score more goals than ${teamName(fixture, second.side)}?`,
        outcomes,
      };
    }
  }

  if (question.template === "period_corners_intra") {
    return {
      text: "Will second-half corners beat first-half corners?",
      outcomes,
    };
  }

  if (question.template === "corners_inter_benchmark") {
    return {
      text: `Previous match: ${question.benchmarkValue ?? "?"} total corners. Will this match finish Higher or Lower?`,
      outcomes,
    };
  }

  if (question.template === "team_goals_inter_benchmark") {
    const first = sideAndStat(question.statKey1);
    const name = first ? teamName(fixture, first.side) : "this team";
    return {
      text: `Will ${name} score more goals than ${name} did last match (${question.benchmarkValue ?? "?"})?`,
      outcomes,
    };
  }

  if (question.template === "goals_exact_margin") {
    const first = sideAndStat(question.statKey1);
    const second = sideAndStat(question.statKey2);
    const threshold = question.threshold ?? 1;
    if (first && second) {
      return {
        text: `Will ${teamName(fixture, first.side)} score exactly ${threshold} more goal${threshold === 1 ? "" : "s"} than ${teamName(fixture, second.side)}?`,
        outcomes,
      };
    }
  }

  if (
    question.template === "total_goals_last10" ||
    question.template === "total_corners_last10" ||
    question.template === "total_yellow_cards_last10"
  ) {
    const info = sideAndStat(question.statKey1);
    const statLabel = info ? STAT_LABEL[info.stat] ?? info.stat : "events";
    return {
      text: `Last 10 matches averaged ${question.benchmarkValue ?? "?"} ${statLabel}. Will this match finish Higher or Lower?`,
      outcomes,
    };
  }

  if (
    question.template === "team_goals_last10_home" ||
    question.template === "team_goals_last10_away"
  ) {
    const info = sideAndStat(question.statKey1);
    const name = info ? teamName(fixture, info.side) : "this team";
    return {
      text: `Will ${name} score more goals than their last-10 average (${question.benchmarkValue ?? "?"})?`,
      outcomes,
    };
  }

  if (question.template === "period_goals_intra") {
    return { text: "Will second-half goals beat first-half goals?", outcomes };
  }

  if (question.template === "red_card_occurrence") {
    return { text: "Will there be a red card in this match?", outcomes };
  }

  // Remaining templates are all "<side> has more <stat> than <side>"
  // intra-fixture comparisons (corners_intra, yellow_cards_intra,
  // red_cards_intra).
  const first = sideAndStat(question.statKey1);
  const second = sideAndStat(question.statKey2);
  if (first && second) {
    const statLabel = STAT_LABEL[first.stat] ?? first.stat;
    return {
      text: `Will ${teamName(fixture, first.side)} have more ${statLabel} than ${teamName(fixture, second.side)}?`,
      outcomes,
    };
  }

  return { text: "Prediction question", outcomes };
}

function questionPayload(question: QuestionRow, fixture: FixtureRow) {
  const copy = renderCopy(question, fixture);
  return {
    id: question.id,
    template: question.template,
    tier: question.template === "winner" ? "primary" : undefined,
    status: question.status,
    result: question.result,
    opensAt: question.opensAt,
    locksAt: question.locksAt,
    settledAt: question.settledAt,
    question: copy.text,
    outcomes: copy.outcomes,
    rule: {
      statKey1: question.statKey1,
      statKey2: question.statKey2,
      period: question.period,
      operator: question.operator,
      comparison: question.comparison,
      threshold: question.threshold,
      benchmarkValue: question.benchmarkValue,
    },
    fixture: {
      id: fixture.id,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      startsAt: fixture.startsAt,
      gameState: fixture.gameState,
      stats: fixture.stats,
    },
  };
}

/**
 * GET /api/questions — public: guests browse and drag cards before
 * authenticating (PRD "no authentication wall before first card"). Lists
 * every open/locked/live/settling/settled question with its fixture and
 * rendered copy, winner-market questions first so the card deck opens on
 * the primary question.
 */
export function createQuestionsRoute(getDb: DbProvider) {
  return new Hono().get("/questions", async (c) => {
    const db = await getDb();
    const rows = await db
      .select({ question: questions, fixture: fixtures })
      .from(questions)
      .innerJoin(fixtures, eq(questions.fixtureId, fixtures.id))
      .where(inArray(questions.status, VISIBLE_STATUSES))
      .orderBy(asc(questions.createdAt));

    return c.json(
      rows
        .map((row) => questionPayload(row.question, row.fixture))
        .sort((a, b) => {
          if (a.template === "winner" && b.template !== "winner") return -1;
          if (b.template === "winner" && a.template !== "winner") return 1;
          return 0;
        }),
    );
  });
}
