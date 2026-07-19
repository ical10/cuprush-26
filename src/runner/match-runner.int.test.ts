import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import {
  ACTIVE_LEAD_MS,
  abortableSleep,
  createPostgresAdvisoryLock,
  hasActiveMatchWork,
  RECENT_LIVE_MS,
  runMatchRunner,
  SCHEDULED_RECOVERY_MS,
} from "./match-runner";

const firstClient = postgres(testDatabaseUrl(), { max: 1 });
const secondClient = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(firstClient, { schema });
const { fixtures, questions } = schema;

beforeEach(async () => {
  await firstClient`truncate table predictions, prediction_batches, questions, fixtures, users, participants restart identity cascade`;
});

afterAll(async () => {
  await Promise.all([firstClient.end(), secondClient.end()]);
});

describe("match runner advisory lock", () => {
  it("prevents overlapping runners and becomes available after cleanup", async () => {
    const first = createPostgresAdvisoryLock(firstClient);
    const second = createPostgresAdvisoryLock(secondClient);

    expect(await first.acquire()).toBe(true);
    expect(await second.acquire()).toBe(false);
    await second.release();

    await first.release();
    const next = createPostgresAdvisoryLock(secondClient);
    expect(await next.acquire()).toBe(true);
    await next.release();
  });

  it("prevents overlap at runner level and releases the lock after abort cleanup", async () => {
    const abortController = new AbortController();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const scheduler = {
      subscribe() {},
      stop() {},
      async tick() {
        return {
          fixturesGenerated: 0,
          questionsInserted: 0,
          openedCount: 0,
          lockedCount: 0,
          replaysFinishedCount: 0,
          fixtureCatchUpCount: 0,
          overdueSettlingCount: 0,
        };
      },
    };
    const txLineClient = {
      async prepare() {},
      async start() {
        markStarted?.();
      },
      waitForFailure: () => new Promise<Error>(() => {}),
      async stop() {},
    };
    const base = {
      scheduler,
      txLineClient,
      reconcile: async () => {},
      settle: async () => {},
      hasActiveWork: async () => true,
    };

    const first = runMatchRunner({
      ...base,
      lock: createPostgresAdvisoryLock(firstClient),
      signal: abortController.signal,
      sleep: abortableSleep,
    });
    await started;

    const overlapping = await runMatchRunner({
      ...base,
      lock: createPostgresAdvisoryLock(secondClient),
    });
    expect(overlapping).toEqual({ outcome: "lock_contended", cycles: 0 });

    abortController.abort();
    await expect(first).resolves.toMatchObject({ outcome: "aborted" });

    const afterCleanup = await runMatchRunner({
      ...base,
      lock: createPostgresAdvisoryLock(secondClient),
      hasActiveWork: async () => false,
      sleep: async () => {},
    });
    expect(afterCleanup).toEqual({ outcome: "idle", cycles: 1 });
  });
});

const NOW = new Date("2030-06-20T12:00:00.000Z");

async function insertFixture(
  overrides: Partial<typeof fixtures.$inferInsert> = {},
): Promise<string> {
  const id = overrides.id ?? `runner-fixture-${randomUUID()}`;
  await db.insert(fixtures).values({
    id,
    homeTeam: "Home",
    awayTeam: "Away",
    startsAt: new Date(NOW.getTime() + 24 * 60 * 60_000),
    ...overrides,
  });
  return id;
}

async function insertQuestion(
  fixtureId: string,
  status: "live" | "settling",
): Promise<void> {
  await db.insert(questions).values({
    fixtureId,
    template: "winner",
    statKey1: "home.full_time.goals",
    statKey2: "away.full_time.goals",
    operator: "subtract",
    comparison: "greater_than",
    threshold: 0,
    opensAt: new Date(NOW.getTime() - 6 * 60 * 60_000),
    locksAt: new Date(NOW.getTime() - 30 * 60_000),
    ruleHash: `runner-rule-${randomUUID()}`,
    status,
  });
}

describe("hasActiveMatchWork", () => {
  it("activates for a scheduled fixture just inside the 40-minute lead window", async () => {
    await insertFixture({ startsAt: new Date(NOW.getTime() + ACTIVE_LEAD_MS - 1) });

    expect(await hasActiveMatchWork(db, NOW)).toBe(true);
  });

  it("stays idle for a scheduled fixture just outside the 40-minute lead window", async () => {
    await insertFixture({ startsAt: new Date(NOW.getTime() + ACTIVE_LEAD_MS + 1) });

    expect(await hasActiveMatchWork(db, NOW)).toBe(false);
  });

  it("activates for a scheduled fixture just inside the missed-kickoff recovery window", async () => {
    await insertFixture({
      startsAt: new Date(NOW.getTime() - SCHEDULED_RECOVERY_MS + 1),
    });

    expect(await hasActiveMatchWork(db, NOW)).toBe(true);
  });

  it("stays idle for a scheduled fixture just outside the missed-kickoff recovery window", async () => {
    await insertFixture({
      startsAt: new Date(NOW.getTime() - SCHEDULED_RECOVERY_MS - 1),
    });

    expect(await hasActiveMatchWork(db, NOW)).toBe(false);
  });

  it("activates for a recent live fixture", async () => {
    await insertFixture({
      gameState: "live",
      startsAt: new Date(NOW.getTime() - RECENT_LIVE_MS + 1),
    });

    expect(await hasActiveMatchWork(db, NOW)).toBe(true);
  });

  it("stays idle for a stale live fixture", async () => {
    await insertFixture({
      gameState: "live",
      startsAt: new Date(NOW.getTime() - RECENT_LIVE_MS - 1),
    });

    expect(await hasActiveMatchWork(db, NOW)).toBe(false);
  });

  it("activates while a question is live even without an active fixture", async () => {
    const fixtureId = await insertFixture({ gameState: "finished" });
    await insertQuestion(fixtureId, "live");

    expect(await hasActiveMatchWork(db, NOW)).toBe(true);
  });

  it("ignores settling-only work when chain writes are disabled", async () => {
    const fixtureId = await insertFixture({ gameState: "finished" });
    await insertQuestion(fixtureId, "settling");

    expect(await hasActiveMatchWork(db, NOW)).toBe(false);
    expect(await hasActiveMatchWork(db, NOW, true)).toBe(true);
  });
});
