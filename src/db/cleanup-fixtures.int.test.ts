import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./test/test-db";
import * as schema from "./schema";
import { cleanupFixtures } from "./cleanup-fixtures";
import { parseTeamAllowlist } from "../txline/allowlist";
import { createQuestionScheduler } from "../questions/scheduler";

const { fixtures, questions } = schema;
const sql = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(sql, { schema });

afterAll(async () => {
  await sql.end();
});

const ALLOWLIST = parseTeamAllowlist("Spain,Argentina,England,France");

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

async function insertFixture(overrides: Partial<typeof fixtures.$inferInsert> = {}) {
  const id = overrides.id ?? `cleanup-${randomUUID()}`;
  await db.insert(fixtures).values({
    id,
    homeTeam: "Myanmar",
    awayTeam: "Vietnam",
    startsAt: minutesFromNow(120),
    ...overrides,
  });
  return id;
}

async function insertQuestion(
  fixtureId: string,
  overrides: Partial<typeof questions.$inferInsert> = {},
) {
  const [row] = await db
    .insert(questions)
    .values({
      fixtureId,
      template: "winner",
      statKey1: "home.full_time.goals",
      statKey2: "away.full_time.goals",
      operator: "subtract",
      comparison: "greater_than",
      threshold: 0,
      opensAt: minutesFromNow(-10),
      locksAt: minutesFromNow(10),
      ruleHash: `rule-${randomUUID()}`,
      status: "open",
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

async function gameState(id: string): Promise<string | undefined> {
  const [row] = await db.select().from(fixtures).where(eq(fixtures.id, id));
  return row?.gameState;
}

async function questionStatus(id: string): Promise<string | undefined> {
  const [row] = await db.select().from(questions).where(eq(questions.id, id));
  return row?.status;
}

describe("cleanupFixtures", () => {
  it("refuses to run without an allowlist", async () => {
    await expect(
      cleanupFixtures(db, { allowlist: null, confirm: true }),
    ).rejects.toThrow(/refuses to run/i);
  });

  it("dry-run reports junk to cancel but changes nothing", async () => {
    const junk = await insertFixture({ homeTeam: "Myanmar", awayTeam: "Vietnam" });
    const real = await insertFixture({ homeTeam: "Spain", awayTeam: "Argentina" });

    const summary = await cleanupFixtures(db, { allowlist: ALLOWLIST, confirm: false });

    expect(summary.confirmed).toBe(false);
    expect(summary.cancelled).toBe(0);
    expect(summary.toCancel.map((f) => f.id)).toContain(junk);
    expect(summary.toCancel.map((f) => f.id)).not.toContain(real);
    // Nothing mutated.
    expect(await gameState(junk)).toBe("scheduled");
    expect(await gameState(real)).toBe("scheduled");
  });

  it("confirm cancels junk fixtures; the scheduler then voids their open questions", async () => {
    const junk = await insertFixture({ homeTeam: "Myanmar", awayTeam: "Vietnam" });
    const question = await insertQuestion(junk, { status: "open" });

    const summary = await cleanupFixtures(db, { allowlist: ALLOWLIST, confirm: true });

    expect(summary.confirmed).toBe(true);
    expect(summary.cancelled).toBeGreaterThanOrEqual(1);
    expect(await gameState(junk)).toBe("cancelled");
    // Question still open until the scheduler processes the cancellation.
    expect(await questionStatus(question.id)).toBe("open");

    const scheduler = createQuestionScheduler({ db });
    await scheduler.handleFixtureUpdate({
      fixtureId: junk,
      seq: 0,
      gameState: "cancelled",
      stats: {},
    });

    expect(await questionStatus(question.id)).toBe("void");
  });

  it("leaves finished junk fixtures intact and reports their count", async () => {
    const finishedJunk = await insertFixture({
      homeTeam: "Myanmar",
      awayTeam: "Vietnam",
      gameState: "finished",
    });
    const settled = await insertQuestion(finishedJunk, { status: "settled" });

    const summary = await cleanupFixtures(db, { allowlist: ALLOWLIST, confirm: true });

    expect(summary.finishedJunk).toBeGreaterThanOrEqual(1);
    expect(summary.toCancel.map((f) => f.id)).not.toContain(finishedJunk);
    expect(await gameState(finishedJunk)).toBe("finished");
    expect(await questionStatus(settled.id)).toBe("settled");
  });

  it("is idempotent — a second confirmed pass cancels nothing new", async () => {
    await insertFixture({ homeTeam: "Myanmar", awayTeam: "Vietnam" });

    await cleanupFixtures(db, { allowlist: ALLOWLIST, confirm: true });
    const second = await cleanupFixtures(db, { allowlist: ALLOWLIST, confirm: true });

    expect(second.cancelled).toBe(0);
  });
});
