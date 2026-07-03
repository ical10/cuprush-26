import { and, eq, gt, lte } from "drizzle-orm";
import { db, queryClient } from "./client";
import { fixtures, questions } from "./schema";
import { generateQuestionsForFixture } from "../questions/generate";

/**
 * Local demo seed (not for production): one finished benchmark fixture plus
 * one fixture kicking off in ~2 hours, so the deterministic generator makes
 * a winner card plus an inter-fixture benchmark card, both inside their open
 * window right now. Lets you run `pnpm dev` and immediately swipe real cards
 * instead of hitting the "no open questions" empty state. Idempotent: fixed
 * fixture ids + the generator's rule-hash unique constraint mean re-running
 * inserts nothing new.
 */
async function seedDemo() {
  const now = Date.now();

  const benchmarkId = "demo-benchmark-bra-ger";
  const upcomingId = "demo-upcoming-arg-fra";

  await db
    .insert(fixtures)
    .values({
      id: benchmarkId,
      homeTeam: "Brazil",
      awayTeam: "Germany",
      // Finished three days ago, with full-time stats so the inter-fixture
      // corner benchmark ("beat the previous match's corners") is provable.
      startsAt: new Date(now - 3 * 24 * 60 * 60 * 1000),
      gameState: "finished",
      stage: "early_knockout",
      lastSeq: 100,
      stats: {
        full_time: {
          home: { goals: 2, yellowCards: 1, redCards: 0, corners: 7 },
          away: { goals: 1, yellowCards: 3, redCards: 1, corners: 4 },
        },
      },
    })
    .onConflictDoNothing();

  await db
    .insert(fixtures)
    .values({
      id: upcomingId,
      homeTeam: "Argentina",
      awayTeam: "France",
      // Kickoff in 2h → opens_at (kickoff−6h) is past and locks_at
      // (kickoff−30m) is future, so its questions are open to answer now.
      startsAt: new Date(now + 2 * 60 * 60 * 1000),
      gameState: "scheduled",
      stage: "early_knockout",
    })
    .onConflictDoNothing();

  const { attempted, inserted } = await generateQuestionsForFixture(db, upcomingId);

  // Force this fixture's currently-in-window questions to `open`. A running
  // scheduler would do this within a minute, but the seed should leave them
  // immediately swipeable without waiting for (or running) the server.
  const nowDate = new Date();
  const opened = await db
    .update(questions)
    .set({ status: "open" })
    .where(
      and(
        eq(questions.fixtureId, upcomingId),
        eq(questions.status, "scheduled"),
        lte(questions.opensAt, nowDate),
        gt(questions.locksAt, nowDate),
      ),
    )
    .returning({ id: questions.id, template: questions.template });

  console.log(
    `seed:demo — generated ${inserted.length}/${attempted} question(s), ` +
      `opened ${opened.length}: ${opened.map((q) => q.template).join(", ") || "none"}`,
  );

  await queryClient.end({ timeout: 5 });
}

seedDemo().catch((error: unknown) => {
  console.error("seed:demo failed", error);
  process.exit(1);
});
