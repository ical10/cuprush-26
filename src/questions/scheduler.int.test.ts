import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { createQuestionScheduler } from "./scheduler";

const { fixtures, questions } = schema;
const sql = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(sql, { schema });

afterAll(async () => {
  await sql.end();
});

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

async function insertFixture(overrides: Partial<typeof fixtures.$inferInsert> = {}) {
  const id = overrides.id ?? `fixture-${randomUUID()}`;
  await db.insert(fixtures).values({
    id,
    homeTeam: "Argentina",
    awayTeam: "France",
    startsAt: minutesFromNow(120),
    stage: "group",
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
      status: "live",
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

async function questionStatus(id: string): Promise<string | undefined> {
  const [row] = await db.select().from(questions).where(eq(questions.id, id));
  return row?.status;
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("waitUntil: condition never became true");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("scheduler.tick — time-driven transitions", () => {
  it("advances a scheduled question to open once opens_at has passed", async () => {
    const fixtureId = await insertFixture();
    const question = await insertQuestion(fixtureId, {
      status: "scheduled",
      opensAt: minutesFromNow(-1),
      locksAt: minutesFromNow(200),
    });

    const scheduler = createQuestionScheduler({ db });
    await scheduler.tick();

    expect(await questionStatus(question.id)).toBe("open");
  });

  it("leaves a scheduled question alone before opens_at", async () => {
    const fixtureId = await insertFixture();
    const question = await insertQuestion(fixtureId, {
      status: "scheduled",
      opensAt: minutesFromNow(300),
      locksAt: minutesFromNow(330),
    });

    const scheduler = createQuestionScheduler({ db });
    await scheduler.tick();

    expect(await questionStatus(question.id)).toBe("scheduled");
  });

  it("advances an open question to locked once locks_at has passed", async () => {
    const fixtureId = await insertFixture();
    const question = await insertQuestion(fixtureId, {
      status: "open",
      opensAt: minutesFromNow(-300),
      locksAt: minutesFromNow(-1),
    });

    const scheduler = createQuestionScheduler({ db });
    await scheduler.tick();

    expect(await questionStatus(question.id)).toBe("locked");
  });

  it("uses the injected clock rather than real time", async () => {
    const fixtureId = await insertFixture();
    const opensAt = new Date("2030-01-01T00:00:00.000Z");
    const question = await insertQuestion(fixtureId, {
      status: "scheduled",
      opensAt,
      locksAt: new Date("2030-01-01T06:00:00.000Z"),
    });

    const scheduler = createQuestionScheduler({ db, clock: () => new Date("2030-01-01T00:00:00.000Z") });
    await scheduler.tick();

    expect(await questionStatus(question.id)).toBe("open");
  });
});

describe("scheduler.tick — question generation", () => {
  it("generates questions once for a fixture whose kickoff is within 6h, and again is a no-op (rule-hash dedupe)", async () => {
    const fixtureId = await insertFixture({ startsAt: minutesFromNow(60), stage: "group" });

    const scheduler = createQuestionScheduler({ db, selectorOptions: { env: {} } });
    const first = await scheduler.tick();
    const second = await scheduler.tick();

    expect(first.fixturesGenerated).toBeGreaterThanOrEqual(1);
    expect(first.questionsInserted).toBeGreaterThan(0);
    expect(second.questionsInserted).toBe(0);

    const rows = await db.select().from(questions).where(eq(questions.fixtureId, fixtureId));
    expect(rows.length).toBe(first.questionsInserted);
  });

  it("does not generate questions for a fixture more than 6h from kickoff", async () => {
    const fixtureId = await insertFixture({ startsAt: minutesFromNow(600) });

    const scheduler = createQuestionScheduler({ db, selectorOptions: { env: {} } });
    await scheduler.tick();

    const rows = await db.select().from(questions).where(eq(questions.fixtureId, fixtureId));
    expect(rows).toHaveLength(0);
  });
});

describe("scheduler.handleFixtureUpdate — event-driven transitions", () => {
  it("moves a locked question to live when the fixture goes live", async () => {
    const fixtureId = await insertFixture();
    const question = await insertQuestion(fixtureId, { status: "locked" });

    const scheduler = createQuestionScheduler({ db });
    await scheduler.handleFixtureUpdate({ fixtureId, seq: 1, gameState: "live", stats: {} });

    expect(await questionStatus(question.id)).toBe("live");
  });

  it("moves a live question to settling on a terminal fixture state", async () => {
    const fixtureId = await insertFixture();
    const question = await insertQuestion(fixtureId, { status: "live" });

    const scheduler = createQuestionScheduler({ db });
    await scheduler.handleFixtureUpdate({ fixtureId, seq: 2, gameState: "finished", stats: {} });

    const [row] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(row?.status).toBe("settling");
    expect(row?.settlingAt).not.toBeNull();
  });

  it("does not touch the settled result fields when moving to settling", async () => {
    const fixtureId = await insertFixture();
    const question = await insertQuestion(fixtureId, { status: "live" });

    const scheduler = createQuestionScheduler({ db });
    await scheduler.handleFixtureUpdate({ fixtureId, seq: 2, gameState: "finished", stats: {} });

    const [row] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(row?.result).toBeNull();
    expect(row?.settledAt).toBeNull();
  });

  it.each(["postponed", "cancelled", "abandoned"] as const)(
    "voids an in-flight question on a %s fixture, preserving no result",
    async (gameState) => {
      const fixtureId = await insertFixture();
      const question = await insertQuestion(fixtureId, { status: "open" });

      const scheduler = createQuestionScheduler({ db });
      await scheduler.handleFixtureUpdate({ fixtureId, seq: 3, gameState, stats: {} });

      const [row] = await db.select().from(questions).where(eq(questions.id, question.id));
      expect(row?.status).toBe("void");
      expect(row?.result).toBeNull();
    },
  );

  it("is idempotent: handling the same terminal event twice only transitions once", async () => {
    const fixtureId = await insertFixture();
    const question = await insertQuestion(fixtureId, { status: "live" });

    const scheduler = createQuestionScheduler({ db });
    await scheduler.handleFixtureUpdate({ fixtureId, seq: 2, gameState: "finished", stats: {} });
    const [firstRow] = await db.select().from(questions).where(eq(questions.id, question.id));
    const firstSettlingAt = firstRow?.settlingAt?.getTime();

    // A second, duplicate terminal event must not re-stamp settling_at or
    // move the question anywhere else — the conditional UPDATE's WHERE
    // clause (status = 'live') no longer matches.
    await scheduler.handleFixtureUpdate({ fixtureId, seq: 2, gameState: "finished", stats: {} });
    const [secondRow] = await db.select().from(questions).where(eq(questions.id, question.id));

    expect(secondRow?.status).toBe("settling");
    expect(secondRow?.settlingAt?.getTime()).toBe(firstSettlingAt);
  });

  it("does not move a scheduled/open/locked question straight to settling", async () => {
    const fixtureId = await insertFixture();
    const question = await insertQuestion(fixtureId, { status: "open" });

    const scheduler = createQuestionScheduler({ db });
    await scheduler.handleFixtureUpdate({ fixtureId, seq: 2, gameState: "finished", stats: {} });

    expect(await questionStatus(question.id)).toBe("open");
  });
});

describe("scheduler.tick — overdue settling scan", () => {
  it("counts (without transitioning) a question settling for over 30 minutes", async () => {
    const fixtureId = await insertFixture();
    await insertQuestion(fixtureId, { status: "settling", settlingAt: minutesFromNow(-31) });

    const scheduler = createQuestionScheduler({ db });
    const result = await scheduler.tick();

    expect(result.overdueSettlingCount).toBeGreaterThanOrEqual(1);
  });

  it("does not count a question settling for under 30 minutes", async () => {
    const fixtureId = await insertFixture();
    const question = await insertQuestion(fixtureId, { status: "settling", settlingAt: minutesFromNow(-5) });

    const scheduler = createQuestionScheduler({ db });
    await scheduler.tick();

    // Still settling — the scan only counts/logs, never transitions.
    expect(await questionStatus(question.id)).toBe("settling");
  });
});

describe("scheduler.start/stop", () => {
  it("runs a tick immediately on start and stops cleanly", async () => {
    const fixtureId = await insertFixture();
    const question = await insertQuestion(fixtureId, {
      status: "scheduled",
      opensAt: minutesFromNow(-1),
      locksAt: minutesFromNow(200),
    });

    const scheduler = createQuestionScheduler({ db, intervalMs: 3_600_000 });
    scheduler.start();
    try {
      // start() fires an immediate tick in the background (fire-and-forget)
      // — poll rather than assume it lands within a fixed delay, since a
      // shared test DB can accumulate other fixtures for tick() to process.
      await waitUntil(async () => (await questionStatus(question.id)) === "open");
    } finally {
      scheduler.stop();
    }
  });
});
