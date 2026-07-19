import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "./test/test-db";
import * as schema from "./schema";
import type { FixtureStats } from "./schema";
import { createStubChainAdapter } from "../chain";
import { evaluateQuestion } from "../questions/evaluate";
import { createQuestionScheduler } from "../questions/scheduler";
import { createSettlementExecutor } from "../questions/settle";
import type { TemplateId } from "../questions/types";
import {
  encodeReplayId,
  type ReplayMetaFetcher,
  type ReplayStatsFetcher,
} from "../txline/replay-source";
import type { TxLineFixtureSnapshot } from "../txline/schema";
import { seedReplays } from "./seed-replays";

const { fixtures, participants, predictionBatches, predictions, questions } = schema;
const sql = postgres(testDatabaseUrl(), { max: 4 });
const db = drizzle(sql, { schema });

afterAll(async () => {
  await sql.end();
});

// A home win, so the winner card resolves decisively (home 2, away 1).
function homeWinStats(): FixtureStats {
  return {
    full_time: {
      home: { goals: 2, yellowCards: 1, redCards: 0, corners: 6 },
      away: { goals: 1, yellowCards: 2, redCards: 0, corners: 4 },
    },
    first_half: {
      home: { goals: 1, yellowCards: 0, redCards: 0, corners: 3 },
      away: { goals: 0, yellowCards: 1, redCards: 0, corners: 2 },
    },
    second_half: {
      home: { goals: 1, yellowCards: 1, redCards: 0, corners: 3 },
      away: { goals: 1, yellowCards: 1, redCards: 0, corners: 2 },
    },
  };
}

function makeSourceId(): string {
  return `9${Math.floor(Math.random() * 1e8)}`;
}

/** A mocked TxLINE fixtures snapshot the seed resolves teams from. */
function metaFetcherFor(sourceIds: string[]): ReplayMetaFetcher {
  const snapshot: TxLineFixtureSnapshot[] = sourceIds.map((id) => ({
    fixtureId: id,
    homeTeam: `Replay-Home-${id}`,
    awayTeam: `Replay-Away-${id}`,
    startsAt: new Date(Date.now() - 4 * 60 * 60_000).toISOString(),
    gameState: "finished",
    seq: 0,
    stats: {},
    competition: "World Cup",
    competitionId: 72,
  }));
  return async () => snapshot;
}

async function winnerQuestion(fixtureId: string) {
  const [row] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.fixtureId, fixtureId), eq(questions.template, "winner")));
  if (!row) throw new Error(`no winner question for ${fixtureId}`);
  return row;
}

async function statusOf(questionId: string): Promise<string | undefined> {
  const [row] = await db.select().from(questions).where(eq(questions.id, questionId));
  return row?.status;
}

async function gameStateOf(fixtureId: string): Promise<string | undefined> {
  const [row] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
  return row?.gameState;
}

async function addConfirmedPrediction(
  questionId: string,
  fixtureId: string,
  outcome: "yes" | "no" | "higher" | "lower",
) {
  const [participant] = await db
    .insert(participants)
    .values({ kind: "human", displayName: `p-${randomUUID().slice(0, 8)}` })
    .returning();
  const [batch] = await db
    .insert(predictionBatches)
    .values({
      participantId: participant!.id,
      fixtureId,
      batchHash: randomBytes(32).toString("hex"),
      chainStatus: "confirmed",
    })
    .returning();
  await db
    .insert(predictions)
    .values({ participantId: participant!.id, questionId, outcome, batchId: batch!.id });
  return participant!.id;
}

describe("seed:replays + finisher lifecycle", () => {
  it("generates, opens, locks, finishes via TxLINE fetch, catches up, settles and scores", async () => {
    const sourceId = makeSourceId();
    const replayId = encodeReplayId(sourceId, 0);
    const base = new Date();

    const summary = await seedReplays({
      db,
      sourceIds: [sourceId],
      metaFetcher: metaFetcherFor([sourceId]),
      now: base,
      startOffsetMs: 50 * 60_000,
      spacingMs: 25 * 60_000,
    });
    expect(summary.inserted).toBe(1);
    expect(summary.insertedIds).toContain(replayId);

    const [seeded] = await db.select().from(fixtures).where(eq(fixtures.id, replayId));
    expect(seeded!.gameState).toBe("scheduled");
    expect(seeded!.stats).toEqual({}); // empty at insert — TxLINE fills at finish
    expect(seeded!.homeTeam).toBe(`Replay-Home-${sourceId}`);

    const stats = homeWinStats();
    const fetcher = vi.fn<ReplayStatsFetcher>(async () => ({ stats, lastSeq: 42 }));
    let nowMs = base.getTime();
    const scheduler = createQuestionScheduler({
      db,
      clock: () => new Date(nowMs),
      selectorOptions: { env: {} },
      replayStatsFetcher: fetcher,
    });

    // Tick 1: generate + open (opens_at is kickoff-6h, already past).
    await scheduler.tick();
    const question = await winnerQuestion(replayId);
    expect(await statusOf(question.id)).toBe("open");

    // Predict the outcome the finisher's stats will actually settle to, so the
    // test proves scoring regardless of how the winner card frames home/away.
    const evaluated = evaluateQuestion(question.template as TemplateId, question, stats);
    const expectedOutcome = evaluated.status === "ready" ? evaluated.result : "push";
    expect(expectedOutcome === "yes" || expectedOutcome === "no").toBe(true);
    const participantId = await addConfirmedPrediction(
      question.id,
      replayId,
      expectedOutcome as "yes" | "no",
    );

    // Tick 2 (+25m): past locks_at (kickoff-30m), still before finish.
    nowMs = base.getTime() + 25 * 60_000;
    await scheduler.tick();
    expect(await statusOf(question.id)).toBe("locked");
    expect(await gameStateOf(replayId)).toBe("scheduled");
    expect(fetcher).not.toHaveBeenCalled();

    // Tick 3 (+85m): past startsAt(+50m) + duration(30m) → finisher fetches,
    // writes stats + finished, catch-up carries locked→live→settling.
    nowMs = base.getTime() + 85 * 60_000;
    const tick3 = await scheduler.tick();
    expect(tick3.replaysFinishedCount).toBe(1);
    expect(fetcher).toHaveBeenCalledWith(sourceId);

    const [finished] = await db.select().from(fixtures).where(eq(fixtures.id, replayId));
    expect(finished!.gameState).toBe("finished");
    expect(finished!.stats.full_time?.home.goals).toBe(2);
    expect(finished!.lastSeq).toBe(42);
    expect(await statusOf(question.id)).toBe("settling");

    // Settlement drains the whole replay deck; assert on our winner question.
    const executor = createSettlementExecutor({
      db,
      chain: createStubChainAdapter(),
      clock: () => new Date(nowMs),
    });
    const settled = await executor.runOnce();
    expect(settled.settled).toBeGreaterThanOrEqual(1);

    const [q] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(q!.status).toBe("settled");
    expect(q!.result).toBe(expectedOutcome);
    const [p] = await db.select().from(participants).where(eq(participants.id, participantId));
    expect(p!.points).toBe(1);
    expect(p!.currentStreak).toBe(1);
  });

  it("retries on the next tick after a TxLINE fetch failure", async () => {
    const sourceId = makeSourceId();
    const replayId = encodeReplayId(sourceId, 0);
    const base = new Date();
    await seedReplays({
      db,
      sourceIds: [sourceId],
      metaFetcher: metaFetcherFor([sourceId]),
      now: base,
      startOffsetMs: 50 * 60_000,
      spacingMs: 25 * 60_000,
    });

    let call = 0;
    const fetcher = vi.fn<ReplayStatsFetcher>(async () => {
      call += 1;
      if (call === 1) throw new Error("TxLINE snapshot 503");
      return { stats: homeWinStats(), lastSeq: 7 };
    });
    let nowMs = base.getTime();
    const scheduler = createQuestionScheduler({
      db,
      clock: () => new Date(nowMs),
      selectorOptions: { env: {} },
      replayStatsFetcher: fetcher,
    });

    await scheduler.tick(); // generate/open
    nowMs = base.getTime() + 25 * 60_000;
    await scheduler.tick(); // lock

    // First finish attempt: fetch throws → stays scheduled, retried next tick.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    nowMs = base.getTime() + 85 * 60_000;
    const failedTick = await scheduler.tick();
    expect(failedTick.replaysFinishedCount).toBe(0);
    expect(await gameStateOf(replayId)).toBe("scheduled");
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();

    // Second attempt: fetch succeeds → finished.
    nowMs = base.getTime() + 86 * 60_000;
    const okTick = await scheduler.tick();
    expect(okTick.replaysFinishedCount).toBe(1);
    expect(await gameStateOf(replayId)).toBe("finished");
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Drain the settling questions this fixture's catch-up produced so they
    // don't inflate other files' global settlement counts (shared test DB).
    await createSettlementExecutor({
      db,
      chain: createStubChainAdapter(),
      clock: () => new Date(nowMs),
    }).runOnce();
  });

  it("no-ops with a one-time warning when TxLINE creds are absent (null fetcher)", async () => {
    const sourceId = makeSourceId();
    const replayId = encodeReplayId(sourceId, 0);
    const base = new Date();
    await seedReplays({
      db,
      sourceIds: [sourceId],
      metaFetcher: metaFetcherFor([sourceId]),
      now: base,
      startOffsetMs: 50 * 60_000,
      spacingMs: 25 * 60_000,
    });

    let nowMs = base.getTime();
    const scheduler = createQuestionScheduler({
      db,
      clock: () => new Date(nowMs),
      selectorOptions: { env: {} },
      replayStatsFetcher: null,
    });

    await scheduler.tick();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    nowMs = base.getTime() + 85 * 60_000;
    const tick = await scheduler.tick();

    expect(tick.replaysFinishedCount).toBe(0);
    expect(await gameStateOf(replayId)).toBe("scheduled");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("replay_finisher_disabled"),
    );
    warnSpy.mockRestore();
  });

  it("resolves teams from the TxLINE snapshot and skips unknown source ids", async () => {
    const sourceId = makeSourceId();
    const missing = makeSourceId();
    const base = new Date();

    const summary = await seedReplays({
      db,
      sourceIds: [sourceId, missing],
      // Snapshot only carries the resolvable source id.
      metaFetcher: metaFetcherFor([sourceId]),
      now: base,
    });
    expect(summary.inserted).toBe(1);
    expect(summary.missingSources).toEqual([missing]);

    const [seeded] = await db
      .select()
      .from(fixtures)
      .where(eq(fixtures.id, encodeReplayId(sourceId, 0)));
    expect(seeded!.homeTeam).toBe(`Replay-Home-${sourceId}`);
    expect(seeded!.competitionId).toBe(72);
  });

  it("is idempotent on re-seed", async () => {
    const sourceId = makeSourceId();
    const base = new Date();
    const meta = metaFetcherFor([sourceId]);

    const first = await seedReplays({ db, sourceIds: [sourceId], metaFetcher: meta, now: base });
    expect(first.inserted).toBe(1);

    const second = await seedReplays({ db, sourceIds: [sourceId], metaFetcher: meta, now: base });
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("respects REPLAY_INCLUDE / REPLAY_EXCLUDE selection over source ids", async () => {
    const keep = makeSourceId();
    const drop = makeSourceId();
    const base = new Date();

    const summary = await seedReplays({
      db,
      sourceIds: [keep, drop],
      metaFetcher: metaFetcherFor([keep, drop]),
      include: null,
      exclude: [drop],
      now: base,
    });
    expect(summary.selected).toBe(1);
    expect(summary.insertedIds).toEqual([encodeReplayId(keep, 0)]);

    const [dropped] = await db
      .select()
      .from(fixtures)
      .where(eq(fixtures.id, encodeReplayId(drop, 0)));
    expect(dropped).toBeUndefined();
  });
});
