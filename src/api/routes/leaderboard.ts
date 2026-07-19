import { asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { agentCohorts, agents, participantKind, participants } from "../../db/schema";
import type { DbProvider } from "../auth/middleware";

const LEADERBOARD_LIMIT = 50;

type KindFilter = (typeof participantKind.enumValues)[number];

function parseKindFilter(raw: string | undefined): KindFilter | undefined {
  if (raw === undefined) return undefined;
  return (participantKind.enumValues as readonly string[]).includes(raw)
    ? (raw as KindFilter)
    : undefined;
}

/**
 * Public: guests can browse the leaderboard before authenticating.
 *
 * `?kind=human|agent` filters rows to one participant kind; an unrecognized
 * or absent value falls back to the default "Overall" view (all rows).
 * Every row carries `kind` and `cohortName` (agent name comes from a left
 * join through `agents` -> `agent_cohorts`; humans always get null) so the
 * client can never mistake an agent for a human.
 */
export function createLeaderboardRoute(getDb: DbProvider) {
  return new Hono().get("/leaderboard", async (c) => {
    const db = await getDb();
    const kind = parseKindFilter(c.req.query("kind"));

    const rows = await db
      .select({
        displayName: participants.displayName,
        points: participants.points,
        currentStreak: participants.currentStreak,
        bestStreak: participants.bestStreak,
        kind: participants.kind,
        cohortName: agentCohorts.name,
      })
      .from(participants)
      .leftJoin(agents, eq(agents.participantId, participants.id))
      .leftJoin(agentCohorts, eq(agentCohorts.id, agents.cohortId))
      .where(kind ? eq(participants.kind, kind) : undefined)
      // createdAt then id keep full ties stable across refreshes — without
      // them, equal rows shuffle between requests.
      .orderBy(
        desc(participants.points),
        desc(participants.bestStreak),
        asc(participants.createdAt),
        asc(participants.id),
      )
      .limit(LEADERBOARD_LIMIT);
    return c.json(rows);
  });
}
