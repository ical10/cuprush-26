import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import type { FixtureStats } from "../db/schema";
import { createStubChainAdapter } from "../chain";
import { generateQuestionsForFixture, resolveGenerationContext } from "./generate";
import { createSettlementExecutor } from "./settle";

const { fixtures, questions } = schema;
const sql = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(sql, { schema });

// Each test starts from an empty database. The last-10 aggregate queries read
// *every* finished fixture in the table (there is no per-test marker to scope
// them), so deterministic aggregate/count assertions demand a clean slate
// rather than the time-window tricks the old single-fixture tests relied on.
async function truncateAll() {
  await sql`TRUNCATE predictions, prediction_batches, users, questions, fixtures, participants RESTART IDENTITY CASCADE`;
}

beforeEach(truncateAll);

afterAll(async () => {
  // Leave a clean database behind so the finished-fixture settling questions
  // this file's settlement tests create can never be seen by another
  // integration file's global "settling" scan (e.g. settle.int.test.ts).
  await truncateAll();
  await sql.end();
});

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

async function insertFixture(overrides: Partial<typeof fixtures.$inferInsert> = {}) {
  const id = overrides.id ?? `fixture-${randomUUID()}`;
  await db.insert(fixtures).values({
    id,
    homeTeam: "Argentina",
    awayTeam: "France",
    startsAt: hoursFromNow(5),
    stage: "group",
    ...overrides,
  });
  return id;
}

// Distinct per-fixture stats so the last-10 averages are non-integer and
// exercise Math.round. For finished fixture `i` (i = 1..10):
//   total goals        = i + 1   -> sum 65, avg 6.5  -> round 7
//   total yellow cards = i + 2   -> sum 75, avg 7.5  -> round 8
//   total corners      = i + 3   -> sum 85, avg 8.5  -> round 9
//   Argentina (home) goals = i   -> sum 55, avg 5.5  -> round 6
function fullTimeStats(i: number): FixtureStats {
  return {
    full_time: {
      home: { goals: i, yellowCards: 2, redCards: 0, corners: i },
      away: { goals: 1, yellowCards: i, redCards: 0, corners: 3 },
    },
  };
}

const AGGREGATE_EXPECTED = { totalGoals: 7, totalYellow: 8, totalCorners: 9, argentinaGoals: 6 };

// 10 counting fixtures (i = 1..10, the most recent) plus one older "poison"
// fixture whose extreme stats would wreck every average if the query wrongly
// counted an 11th row. Recency increases with i; the poison row is oldest.
async function seedFinishedHistory(): Promise<void> {
  for (let i = 1; i <= 10; i++) {
    await insertFixture({
      id: `hist-${i}-${randomUUID()}`,
      startsAt: hoursFromNow(1000 + i),
      gameState: "finished",
      stats: fullTimeStats(i),
    });
  }
  await insertFixture({
    id: `hist-poison-${randomUUID()}`,
    startsAt: hoursFromNow(1000),
    gameState: "finished",
    stats: {
      full_time: {
        home: { goals: 100, yellowCards: 100, redCards: 100, corners: 100 },
        away: { goals: 100, yellowCards: 100, redCards: 100, corners: 100 },
      },
    },
  });
}

const ALWAYS_AVAILABLE = [
  "winner",
  "corners_intra",
  "goals_exact_margin",
  "period_corners_intra",
  "period_goals_intra",
  "red_card_occurrence",
] as const;

async function templatesFor(fixtureId: string): Promise<string[]> {
  const rows = await db.select().from(questions).where(eq(questions.fixtureId, fixtureId));
  return rows.map((r) => r.template);
}

describe("generateQuestionsForFixture — clean-slate baseline", () => {
  it("with no prior finished fixtures, generates winner + 5 always-available secondaries", async () => {
    const fixtureId = await insertFixture();

    const result = await generateQuestionsForFixture(db, fixtureId);

    // No benchmark and no aggregate data exists, so only the six
    // always-available templates can build: the winner plus corners_intra,
    // goals_exact_margin, both period comparisons, and red_card_occurrence.
    expect(result.attempted).toBe(6);
    expect(result.inserted).toHaveLength(6);

    const templates = await templatesFor(fixtureId);
    expect(new Set(templates)).toEqual(new Set(ALWAYS_AVAILABLE));
  });

  it("is idempotent: regenerating the same fixture inserts no duplicate rows", async () => {
    const fixtureId = await insertFixture();

    await generateQuestionsForFixture(db, fixtureId);
    const second = await generateQuestionsForFixture(db, fixtureId);

    expect(second.inserted).toHaveLength(0);

    const rows = await db.select().from(questions).where(eq(questions.fixtureId, fixtureId));
    expect(rows).toHaveLength(6);
  });

  it("stores opens_at at kickoff-6h and locks_at at kickoff-30m", async () => {
    const startsAt = hoursFromNow(8);
    const fixtureId = await insertFixture({ startsAt });

    await generateQuestionsForFixture(db, fixtureId);

    const [row] = await db.select().from(questions).where(eq(questions.fixtureId, fixtureId)).limit(1);
    expect(row?.opensAt.getTime()).toBe(startsAt.getTime() - 6 * 60 * 60 * 1000);
    expect(row?.locksAt.getTime()).toBe(startsAt.getTime() - 30 * 60 * 1000);
  });

  it("throws for an unknown fixture id", async () => {
    await expect(generateQuestionsForFixture(db, `missing-${randomUUID()}`)).rejects.toThrow();
  });
});

describe("generateQuestionsForFixture — ten-question generation with full history", () => {
  // Seeds 11 finished fixtures (all 11 secondary categories become
  // available), then one upcoming fixture per stage. Group/early_knockout are
  // capped by the 9-secondary budget (10 total); semi_final/final reach the
  // 12-card hard cap.
  it.each([
    ["group", 10],
    ["early_knockout", 10],
    ["semi_final", 12],
    ["final", 12],
  ] as const)("generates exactly %s cards for a %s fixture, all distinct", async (stage, expected) => {
    await seedFinishedHistory();
    const fixtureId = await insertFixture({ stage, startsAt: hoursFromNow(1100) });

    const result = await generateQuestionsForFixture(db, fixtureId);

    expect(result.inserted).toHaveLength(expected);
    const templates = await templatesFor(fixtureId);
    expect(templates).toHaveLength(expected);
    expect(new Set(templates).size).toBe(templates.length);
  });
});

describe("generateQuestionsForFixture — aggregate benchmark correctness", () => {
  it("persists last-10 averages of the 10 most recent finished fixtures (oldest excluded)", async () => {
    await seedFinishedHistory();
    // semi_final so the budget (11) reaches every aggregate template,
    // including team_goals_last10_home/away.
    const fixtureId = await insertFixture({ stage: "semi_final", startsAt: hoursFromNow(1100) });

    await generateQuestionsForFixture(db, fixtureId);
    const rows = await db.select().from(questions).where(eq(questions.fixtureId, fixtureId));
    const byTemplate = new Map(rows.map((r) => [r.template, r]));

    expect(byTemplate.get("total_goals_last10")?.benchmarkValue).toBe(AGGREGATE_EXPECTED.totalGoals);
    expect(byTemplate.get("total_corners_last10")?.benchmarkValue).toBe(
      AGGREGATE_EXPECTED.totalCorners,
    );
    expect(byTemplate.get("total_yellow_cards_last10")?.benchmarkValue).toBe(
      AGGREGATE_EXPECTED.totalYellow,
    );
    // Argentina plays home in every finished fixture, so its own last-10 goals
    // average anchors team_goals_last10_home.
    expect(byTemplate.get("team_goals_last10_home")?.benchmarkValue).toBe(
      AGGREGATE_EXPECTED.argentinaGoals,
    );
  });

  it("resolveGenerationContext exposes the same hand-computed aggregates", async () => {
    await seedFinishedHistory();
    const fixtureId = await insertFixture({ startsAt: hoursFromNow(1100) });
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    if (!fixture) throw new Error("fixture missing");

    const ctx = await resolveGenerationContext(db, fixture);

    expect(ctx.lastTen?.totalGoals?.average).toBe(AGGREGATE_EXPECTED.totalGoals);
    expect(ctx.lastTen?.totalGoals?.sampleCount).toBe(10);
    expect(ctx.lastTen?.totalCorners?.average).toBe(AGGREGATE_EXPECTED.totalCorners);
    expect(ctx.lastTen?.totalYellowCards?.average).toBe(AGGREGATE_EXPECTED.totalYellow);
    expect(ctx.teamLastTen?.home?.average).toBe(AGGREGATE_EXPECTED.argentinaGoals);
  });
});

describe("generateQuestionsForFixture — benchmark_fixture_id provenance", () => {
  it("aggregate rows carry NULL benchmark_fixture_id", async () => {
    await seedFinishedHistory();
    const fixtureId = await insertFixture({ stage: "semi_final", startsAt: hoursFromNow(1100) });

    await generateQuestionsForFixture(db, fixtureId);
    const rows = await db.select().from(questions).where(eq(questions.fixtureId, fixtureId));

    const aggregateRows = rows.filter((r) => r.template.includes("_last10"));
    // total_{goals,corners,yellow_cards}_last10 + team_goals_last10_{home,away}
    expect(aggregateRows.length).toBe(5);
    for (const row of aggregateRows) {
      expect(row.benchmarkFixtureId).toBeNull();
    }
  });

  it("single-fixture fallback rows carry a real benchmark_fixture_id", async () => {
    // Exactly one finished fixture: below the 3-sample aggregate guard, so the
    // corners category falls back to the single-fixture corners benchmark.
    const priorId = await insertFixture({
      id: `prior-${randomUUID()}`,
      homeTeam: "Brazil",
      awayTeam: "Germany",
      startsAt: hoursFromNow(-10),
      gameState: "finished",
      stats: {
        full_time: {
          home: { goals: 1, yellowCards: 1, redCards: 0, corners: 6 },
          away: { goals: 0, yellowCards: 0, redCards: 0, corners: 5 },
        },
      },
    });
    const fixtureId = await insertFixture();

    const result = await generateQuestionsForFixture(db, fixtureId);

    const corners = result.inserted.find((q) => q.template === "corners_inter_benchmark");
    expect(corners).toBeDefined();
    expect(corners?.benchmarkValue).toBe(11); // 6 + 5
    expect(corners?.benchmarkFixtureId).toBe(priorId);
  });
});

describe("generateQuestionsForFixture — sparse data (below aggregate guard)", () => {
  it("omits aggregate templates but still generates the always-available set", async () => {
    // Only two finished fixtures: under the 3-sample minimum, so no *_last10
    // template can build.
    await insertFixture({
      id: `sparse-a-${randomUUID()}`,
      startsAt: hoursFromNow(-20),
      gameState: "finished",
      stats: fullTimeStats(4),
    });
    await insertFixture({
      id: `sparse-b-${randomUUID()}`,
      startsAt: hoursFromNow(-10),
      gameState: "finished",
      stats: fullTimeStats(6),
    });
    const fixtureId = await insertFixture();

    await generateQuestionsForFixture(db, fixtureId);
    const templates = await templatesFor(fixtureId);

    expect(templates.some((t) => t.includes("_last10"))).toBe(false);
    for (const always of ALWAYS_AVAILABLE) {
      expect(templates).toContain(always);
    }
  });
});

describe("resolveGenerationContext — single-fixture benchmarks", () => {
  it("finds a team's own previous completed match for the team-goals benchmark", async () => {
    const argPrevId = `arg-prev-${randomUUID()}`;
    await insertFixture({
      id: argPrevId,
      homeTeam: "Argentina",
      awayTeam: "Mexico",
      startsAt: hoursFromNow(-10),
      gameState: "finished",
      stats: {
        full_time: {
          home: { goals: 3, yellowCards: 0, redCards: 0, corners: 4 },
          away: { goals: 1, yellowCards: 0, redCards: 0, corners: 2 },
        },
      },
    });
    const fixtureId = await insertFixture({ homeTeam: "Argentina", awayTeam: "France" });

    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    if (!fixture) throw new Error("fixture missing");
    const ctx = await resolveGenerationContext(db, fixture);

    expect(ctx.teamBenchmark).toEqual({ fixtureId: argPrevId, side: "home", goals: 3 });
  });

  it("returns null benchmarks and aggregates when no completed fixtures exist yet", async () => {
    const fixtureId = await insertFixture();
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    if (!fixture) throw new Error("fixture missing");

    const ctx = await resolveGenerationContext(db, fixture);

    expect(ctx.benchmarkFixture).toBeNull();
    expect(ctx.teamBenchmark).toBeNull();
    expect(ctx.lastTen?.totalGoals).toBeNull();
    expect(ctx.teamLastTen?.home).toBeNull();
  });
});

describe("end-to-end settlement of generated questions", () => {
  // Flips one already-generated question to "settling", populates the
  // fixture's full_time stats, and runs the real settlement executor — the
  // same path production uses — asserting the derived result.
  async function settleTemplate(
    fixtureId: string,
    template: string,
    stats: FixtureStats,
  ): Promise<string | null> {
    const chain = createStubChainAdapter();
    await db
      .update(questions)
      .set({ status: "settling", settlingAt: minutesAgo(1) })
      .where(and(eq(questions.fixtureId, fixtureId), eq(questions.template, template)));
    await db
      .update(fixtures)
      .set({ gameState: "finished", stats })
      .where(eq(fixtures.id, fixtureId));

    const executor = createSettlementExecutor({ db, chain });
    await executor.runOnce();

    const [row] = await db
      .select()
      .from(questions)
      .where(and(eq(questions.fixtureId, fixtureId), eq(questions.template, template)));
    return row?.result ?? null;
  }

  function cornersStats(total: number): FixtureStats {
    return {
      full_time: {
        home: { goals: 0, yellowCards: 0, redCards: 0, corners: total },
        away: { goals: 0, yellowCards: 0, redCards: 0, corners: 0 },
      },
    };
  }

  // Three finished fixtures each with 9 total corners -> aggregate benchmark
  // of exactly 9, so higher/lower/push can be hit precisely.
  async function seedCornerBenchmarkNine(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      await insertFixture({
        id: `corners9-${i}-${randomUUID()}`,
        startsAt: hoursFromNow(-100 - i),
        gameState: "finished",
        stats: {
          full_time: {
            home: { goals: 1, yellowCards: 0, redCards: 0, corners: 5 },
            away: { goals: 0, yellowCards: 0, redCards: 0, corners: 4 },
          },
        },
      });
    }
  }

  it.each([
    ["higher", 12],
    ["lower", 5],
    ["push", 9],
  ] as const)(
    "settles a total_corners_last10 question as %s when actual corners = %i vs benchmark 9",
    async (expected, actualCorners) => {
      await seedCornerBenchmarkNine();
      const fixtureId = await insertFixture({ startsAt: hoursFromNow(5) });

      const result = await generateQuestionsForFixture(db, fixtureId);
      const corners = result.inserted.find((q) => q.template === "total_corners_last10");
      expect(corners?.benchmarkValue).toBe(9);

      const settled = await settleTemplate(
        fixtureId,
        "total_corners_last10",
        cornersStats(actualCorners),
      );
      expect(settled).toBe(expected);
    },
  );

  it("settles red_card_occurrence as yes when a red card occurs", async () => {
    const fixtureId = await insertFixture();
    await generateQuestionsForFixture(db, fixtureId);

    const settled = await settleTemplate(fixtureId, "red_card_occurrence", {
      full_time: {
        home: { goals: 0, yellowCards: 0, redCards: 1, corners: 0 },
        away: { goals: 0, yellowCards: 0, redCards: 0, corners: 0 },
      },
    });
    expect(settled).toBe("yes");
  });

  it("settles red_card_occurrence as no when there is no red card", async () => {
    const fixtureId = await insertFixture();
    await generateQuestionsForFixture(db, fixtureId);

    const settled = await settleTemplate(fixtureId, "red_card_occurrence", {
      full_time: {
        home: { goals: 0, yellowCards: 0, redCards: 0, corners: 0 },
        away: { goals: 0, yellowCards: 0, redCards: 0, corners: 0 },
      },
    });
    expect(settled).toBe("no");
  });
});
