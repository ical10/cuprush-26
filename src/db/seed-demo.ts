import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { db, queryClient } from "./client";
import { fixtures, predictions, questions, type FixtureStage } from "./schema";
import { generateQuestionsForFixture } from "../questions/generate";

/**
 * Local/staging demo seed only — refuses to run when NODE_ENV=production.
 * Production fixtures/questions come exclusively from the TxLINE ingestion
 * client (src/txline/*), never from this script.
 *
 * Inserts ten finished fixtures (so last-10-average benchmark templates are
 * available) plus several upcoming fixtures across tournament stages, so the
 * deterministic generator makes a full 10-12 card deck per fixture. Lets you run `pnpm dev` and immediately exercise
 * a full deck instead of hitting the "no open questions" empty state after
 * one card. Re-runnable any time: each upcoming fixture's kickoff is reset
 * to "2h from now" on every run (and its questions regenerated), so cards
 * never go stale between demos.
 */
const UPCOMING_FIXTURES: { id: string; home: string; away: string; stage: FixtureStage }[] = [
  { id: "demo-upcoming-arg-fra", home: "Argentina", away: "France", stage: "semi_final" },
  { id: "demo-upcoming-bra-eng", home: "Brazil", away: "England", stage: "semi_final" },
  { id: "demo-upcoming-esp-ned", home: "Spain", away: "Netherlands", stage: "group" },
];

async function seedDemo() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Refusing to run: seed:demo inserts fake fixtures/questions and must " +
        "never touch a production database. Production data comes only " +
        "from the TxLINE ingestion client (src/txline/*).",
    );
  }

  const now = Date.now();

  // Ten finished fixtures with full-time stats so every benchmark template is
  // provable: the single-fixture fallbacks and the last-10-average aggregates
  // (which need at least 3 finished matches to become available).
  const FINISHED: [string, string, string, number, number, number, number, number, number, number, number][] = [
    ["demo-finished-01", "Brazil", "Germany", 2, 1, 1, 3, 0, 1, 7, 4],
    ["demo-finished-02", "France", "Spain", 0, 2, 2, 1, 0, 0, 5, 6],
    ["demo-finished-03", "England", "Argentina", 1, 1, 3, 2, 1, 0, 8, 3],
    ["demo-finished-04", "Netherlands", "Brazil", 3, 2, 1, 1, 0, 0, 4, 9],
    ["demo-finished-05", "Germany", "France", 1, 0, 2, 4, 0, 1, 6, 5],
    ["demo-finished-06", "Argentina", "Spain", 2, 2, 0, 2, 0, 0, 10, 2],
    ["demo-finished-07", "England", "Netherlands", 0, 1, 1, 1, 0, 0, 3, 7],
    ["demo-finished-08", "Brazil", "France", 4, 1, 2, 3, 1, 0, 5, 5],
    ["demo-finished-09", "Spain", "Germany", 1, 3, 1, 2, 0, 0, 6, 8],
    ["demo-finished-10", "Argentina", "Netherlands", 2, 0, 3, 1, 0, 1, 9, 4],
  ];
  for (const [i, [id, home, away, hg, ag, hy, ay, hr, ar, hc, ac]] of FINISHED.entries()) {
    await db
      .insert(fixtures)
      .values({
        id,
        homeTeam: home,
        awayTeam: away,
        startsAt: new Date(now - (FINISHED.length - i + 2) * 24 * 60 * 60 * 1000),
        gameState: "finished",
        stage: "early_knockout",
        lastSeq: 100,
        stats: {
          full_time: {
            home: { goals: hg, yellowCards: hy, redCards: hr, corners: hc },
            away: { goals: ag, yellowCards: ay, redCards: ar, corners: ac },
          },
        },
      })
      .onConflictDoNothing();
  }

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
    // locked/expired. Predictions against those stale questions block the
    // delete (FK) once you've actually swiped a demo card, so clear them
    // first — this is local demo data, never real user history.
    const staleQuestionIds = await db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.fixtureId, fixture.id));
    if (staleQuestionIds.length > 0) {
      await db.delete(predictions).where(
        inArray(
          predictions.questionId,
          staleQuestionIds.map((q) => q.id),
        ),
      );
    }
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
