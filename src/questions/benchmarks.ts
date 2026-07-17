import { and, desc, eq, lt, ne, or } from "drizzle-orm";
import type { Database } from "../db/client";
import { fixtures } from "../db/schema";

export type AggregateMetric =
  | "totalGoals"
  | "totalCorners"
  | "totalYellowCards"
  | "homeTeamGoals"
  | "awayTeamGoals";

export type LastMatchesAverage = { average: number; sampleCount: number };

type FixtureRow = typeof fixtures.$inferSelect;

const DEFAULT_LIMIT = 10;
const MIN_SAMPLES = 3;

function averageOf(values: number[]): LastMatchesAverage | null {
  if (values.length < MIN_SAMPLES) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return { average: Math.round(sum / values.length), sampleCount: values.length };
}

/**
 * Pure aggregation: turns recency-ordered fixture rows into the three
 * last-N-matches averages. Only the first `limit` rows count, and only rows
 * with `full_time` stats on both sides qualify — see the minimum-data guard
 * in the plan.
 */
export function computeAverages(
  rows: FixtureRow[],
  limit: number,
): {
  totalGoals: LastMatchesAverage | null;
  totalCorners: LastMatchesAverage | null;
  totalYellowCards: LastMatchesAverage | null;
} {
  const goals: number[] = [];
  const corners: number[] = [];
  const yellowCards: number[] = [];

  for (const row of rows.slice(0, limit)) {
    const fullTime = row.stats.full_time;
    if (!fullTime) continue;
    goals.push(fullTime.home.goals + fullTime.away.goals);
    corners.push(fullTime.home.corners + fullTime.away.corners);
    yellowCards.push(fullTime.home.yellowCards + fullTime.away.yellowCards);
  }

  return {
    totalGoals: averageOf(goals),
    totalCorners: averageOf(corners),
    totalYellowCards: averageOf(yellowCards),
  };
}

/**
 * Pure aggregation for one team's own scoring average: same recency/limit
 * rules as computeAverages, but picks the home or away goals depending on
 * which side `team` played in each row.
 */
export function computeTeamGoalsAverage(
  rows: FixtureRow[],
  limit: number,
  team: string,
): LastMatchesAverage | null {
  const goals: number[] = [];

  for (const row of rows.slice(0, limit)) {
    const fullTime = row.stats.full_time;
    if (!fullTime) continue;
    if (row.homeTeam === team) {
      goals.push(fullTime.home.goals);
    } else if (row.awayTeam === team) {
      goals.push(fullTime.away.goals);
    }
  }

  return averageOf(goals);
}

/**
 * Aggregate benchmarks for a fixture: the average total goals, corners, and
 * yellow cards across the last `limit` (default 10) finished fixtures before
 * `before`, excluding `excludeFixtureId`. One query — all three metrics are
 * computed from the same rows.
 */
export async function lastMatchesAverages(
  db: Database,
  opts: { before: Date; excludeFixtureId: string; limit?: number },
): Promise<{
  totalGoals: LastMatchesAverage | null;
  totalCorners: LastMatchesAverage | null;
  totalYellowCards: LastMatchesAverage | null;
}> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const rows = await db
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.gameState, "finished"),
        lt(fixtures.startsAt, opts.before),
        ne(fixtures.id, opts.excludeFixtureId),
      ),
    )
    .orderBy(desc(fixtures.startsAt))
    .limit(limit);

  return computeAverages(rows, limit);
}

/**
 * One team's own goals average across its last `limit` (default 10) finished
 * fixtures before `before`, whichever side (home or away) it played on.
 */
export async function teamLastMatchesGoalsAverage(
  db: Database,
  opts: { team: string; before: Date; excludeFixtureId: string; limit?: number },
): Promise<LastMatchesAverage | null> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const rows = await db
    .select()
    .from(fixtures)
    .where(
      and(
        eq(fixtures.gameState, "finished"),
        lt(fixtures.startsAt, opts.before),
        ne(fixtures.id, opts.excludeFixtureId),
        or(eq(fixtures.homeTeam, opts.team), eq(fixtures.awayTeam, opts.team)),
      ),
    )
    .orderBy(desc(fixtures.startsAt))
    .limit(limit);

  return computeTeamGoalsAverage(rows, limit, opts.team);
}
