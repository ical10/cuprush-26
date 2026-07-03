import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { generateQuestionsForFixture, resolveGenerationContext } from "./generate";

const { fixtures, questions } = schema;
const sql = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(sql, { schema });

afterAll(async () => {
  await sql.end();
});

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
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

describe("generateQuestionsForFixture", () => {
  it("creates 1 winner + 1 secondary question for a group-stage fixture", async () => {
    const fixtureId = await insertFixture();

    const result = await generateQuestionsForFixture(db, fixtureId);

    expect(result.attempted).toBe(2);
    expect(result.inserted).toHaveLength(2);

    const rows = await db.select().from(questions).where(eq(questions.fixtureId, fixtureId));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.template)).toContain("winner");
  });

  it("is idempotent: regenerating the same fixture inserts no duplicate rows", async () => {
    const fixtureId = await insertFixture();

    await generateQuestionsForFixture(db, fixtureId);
    const second = await generateQuestionsForFixture(db, fixtureId);

    expect(second.inserted).toHaveLength(0);

    const rows = await db.select().from(questions).where(eq(questions.fixtureId, fixtureId));
    expect(rows).toHaveLength(2);
  });

  it("stores opens_at at kickoff-6h and locks_at at kickoff-30m", async () => {
    const startsAt = hoursFromNow(8);
    const fixtureId = await insertFixture({ startsAt });

    await generateQuestionsForFixture(db, fixtureId);

    const [row] = await db.select().from(questions).where(eq(questions.fixtureId, fixtureId)).limit(1);
    expect(row?.opensAt.getTime()).toBe(startsAt.getTime() - 6 * 60 * 60 * 1000);
    expect(row?.locksAt.getTime()).toBe(startsAt.getTime() - 30 * 60 * 1000);
  });

  it("uses the semi_final stage budget to create 4 total questions", async () => {
    const fixtureId = await insertFixture({ stage: "semi_final" });

    const result = await generateQuestionsForFixture(db, fixtureId);

    expect(result.inserted).toHaveLength(4);
  });

  it("picks the inter-fixture corners benchmark once a completed prior fixture exists", async () => {
    await insertFixture({
      id: `benchmark-${randomUUID()}`,
      // Distinct teams so this doesn't also get picked up as a team-goals
      // benchmark by other tests in this file that use Argentina/France.
      homeTeam: "Brazil",
      awayTeam: "Germany",
      // Far in the future so this is always the *most recent* finished
      // fixture before the target — other test files (settle, replay)
      // leave finished fixtures near "now" in the shared DB.
      startsAt: hoursFromNow(9_990),
      gameState: "finished",
      stats: {
        full_time: {
          home: { goals: 1, yellowCards: 1, redCards: 0, corners: 6 },
          away: { goals: 0, yellowCards: 0, redCards: 0, corners: 5 },
        },
      },
    });
    const fixtureId = await insertFixture({ startsAt: hoursFromNow(10_000) });

    const result = await generateQuestionsForFixture(db, fixtureId);

    const cornersQuestion = result.inserted.find((q) => q.template === "corners_inter_benchmark");
    expect(cornersQuestion).toBeDefined();
    expect(cornersQuestion?.benchmarkValue).toBe(11);
  });

  it("throws for an unknown fixture id", async () => {
    await expect(generateQuestionsForFixture(db, `missing-${randomUUID()}`)).rejects.toThrow();
  });
});

describe("resolveGenerationContext", () => {
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

  it("returns null benchmarks when no completed fixtures exist yet", async () => {
    // Far in the past — earlier than any other fixture this file inserts —
    // so the "most recent completed fixture before this one" query has
    // nothing to find, regardless of what other tests have already seeded.
    const fixtureId = await insertFixture({ startsAt: hoursFromNow(-100_000) });
    const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    if (!fixture) throw new Error("fixture missing");

    const ctx = await resolveGenerationContext(db, fixture);

    expect(ctx.benchmarkFixture).toBeNull();
    expect(ctx.teamBenchmark).toBeNull();
  });
});
