import { and, eq, gt, lte } from "drizzle-orm";
import { db, queryClient } from "./client";
import { fixtures, questions, type FixtureStage } from "./schema";
import { generateQuestionsForFixture } from "../questions/generate";

/**
 * Local demo seed (not for production): one finished benchmark fixture plus
 * several upcoming fixtures across tournament stages, so the deterministic
 * generator makes ~10 open cards to swipe through. Lets you run `pnpm dev`
 * and immediately exercise a full deck instead of hitting the "no open
 * questions" empty state after one card. Re-runnable any time: each
 * upcoming fixture's kickoff is reset to "2h from now" on every run (and its
 * questions regenerated), so cards never go stale between demos.
 */
const UPCOMING_FIXTURES: { id: string; home: string; away: string; stage: FixtureStage }[] = [
  { id: "demo-upcoming-arg-fra", home: "Argentina", away: "France", stage: "semi_final" },
  { id: "demo-upcoming-bra-eng", home: "Brazil", away: "England", stage: "semi_final" },
  { id: "demo-upcoming-esp-ned", home: "Spain", away: "Netherlands", stage: "group" },
];

async function seedDemo() {
  const now = Date.now();

  const benchmarkId = "demo-benchmark-bra-ger";
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

  let totalOpened = 0;
  const summary: string[] = [];

  for (const fixture of UPCOMING_FIXTURES) {
    const startsAt = new Date(now + 2 * 60 * 60 * 1000);
    await db
      .insert(fixtures)
      .values({
        id: fixture.id,
        homeTeam: fixture.home,
        awayTeam: fixture.away,
        // Kickoff in 2h → opens_at (kickoff−6h) is past and locks_at
        // (kickoff−30m) is future, so its questions are open to answer now.
        startsAt,
        gameState: "scheduled",
        stage: fixture.stage,
      })
      .onConflictDoUpdate({
        target: fixtures.id,
        set: { startsAt, gameState: "scheduled", stage: fixture.stage },
      });

    // Regenerate from scratch each run: opens_at/locks_at (and the rule
    // hash's benchmark snapshot) are derived from startsAt, so stale rows
    // from a previous run must go rather than silently stick around
    // locked/expired.
    await db.delete(questions).where(eq(questions.fixtureId, fixture.id));

    const { inserted } = await generateQuestionsForFixture(db, fixture.id);

    // Force this fixture's currently-in-window questions to `open`. A
    // running scheduler would do this within a minute, but the seed should
    // leave them immediately swipeable without waiting for (or running)
    // the server.
    const nowDate = new Date();
    const opened = await db
      .update(questions)
      .set({ status: "open" })
      .where(
        and(
          eq(questions.fixtureId, fixture.id),
          eq(questions.status, "scheduled"),
          lte(questions.opensAt, nowDate),
          gt(questions.locksAt, nowDate),
        ),
      )
      .returning({ id: questions.id });

    totalOpened += opened.length;
    summary.push(`${fixture.home} vs ${fixture.away}: ${opened.length}/${inserted.length}`);
  }

  console.log(`seed:demo — ${totalOpened} open card(s) total\n  ${summary.join("\n  ")}`);

  await queryClient.end({ timeout: 5 });
}

seedDemo().catch((error: unknown) => {
  console.error("seed:demo failed", error);
  process.exit(1);
});
