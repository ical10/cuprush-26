import { desc } from "drizzle-orm";
import { Hono } from "hono";
import { participants } from "../../db/schema";
import type { DbProvider } from "../auth/middleware";

const LEADERBOARD_LIMIT = 50;

/** Public: guests can browse the leaderboard before authenticating. */
export function createLeaderboardRoute(getDb: DbProvider) {
  return new Hono().get("/leaderboard", async (c) => {
    const db = await getDb();
    const rows = await db
      .select({
        displayName: participants.displayName,
        points: participants.points,
        currentStreak: participants.currentStreak,
        bestStreak: participants.bestStreak,
      })
      .from(participants)
      .orderBy(desc(participants.points), desc(participants.bestStreak))
      .limit(LEADERBOARD_LIMIT);
    return c.json(rows);
  });
}
