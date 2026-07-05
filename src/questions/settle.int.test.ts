import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { createStubChainAdapter, type ChainAdapter } from "../chain";
import { createSettlementExecutor } from "./settle";

const { fixtures, participants, predictionBatches, predictions, questions } = schema;
const sql = postgres(testDatabaseUrl(), { max: 10 });
const db = drizzle(sql, { schema });

afterAll(async () => {
  await sql.end();
});

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

async function insertFixture(overrides: Partial<typeof fixtures.$inferInsert> = {}) {
  const id = overrides.id ?? `fx-${randomUUID().slice(0, 18)}`;
  await db.insert(fixtures).values({
    id,
    homeTeam: `Settle-Home-${id}`,
    awayTeam: `Settle-Away-${id}`,
    startsAt: minutesAgo(120),
    gameState: "finished",
    stats: { full_time: { home: { goals: 2, yellowCards: 0, redCards: 0, corners: 0 }, away: { goals: 1, yellowCards: 0, redCards: 0, corners: 0 } } },
    ...overrides,
  });
  return id;
}

async function insertSettlingQuestion(
  fixtureId: string,
  chain: ChainAdapter,
  overrides: Partial<typeof questions.$inferInsert> = {},
) {
  const ruleHash = randomBytes(32).toString("hex");
  const questionPda = chain.deriveQuestionPda(ruleHash);
  await chain.createQuestion({
    ruleHash,
    fixtureId,
    benchmarkFixtureId: null,
    statKey1: "home.full_time.goals",
    statKey2: "away.full_time.goals",
    operator: "subtract",
    comparison: "greater_than",
    threshold: 0,
    benchmarkValue: null,
    opensAt: minutesAgo(120),
    locksAt: minutesAgo(90),
  });

  const [question] = await db
    .insert(questions)
    .values({
      fixtureId,
      template: "winner",
      statKey1: "home.full_time.goals",
      statKey2: "away.full_time.goals",
      period: "full_time",
      operator: "subtract",
      comparison: "greater_than",
      threshold: 0,
      status: "settling",
      settlingAt: minutesAgo(1),
      opensAt: minutesAgo(120),
      locksAt: minutesAgo(90),
      ruleHash,
      questionPda,
      ...overrides,
    })
    .returning();
  return question!;
}

async function insertParticipant(overrides: Partial<typeof participants.$inferInsert> = {}) {
  const [row] = await db
    .insert(participants)
    .values({ kind: "human", ...overrides })
    .returning();
  return row!;
}

async function confirmedBatch(participantId: string) {
  const [row] = await db
    .insert(predictionBatches)
    .values({
      participantId,
      batchHash: randomBytes(32).toString("hex"),
      chainStatus: "confirmed",
    })
    .onConflictDoNothing()
    .returning();
  if (row) return row;
  const [existing] = await db
    .select()
    .from(predictionBatches)
    .where(eq(predictionBatches.participantId, participantId));
  return existing!;
}

async function insertConfirmedPrediction(
  questionId: string,
  participantId: string,
  outcome: "yes" | "no" | "higher" | "lower",
) {
  const batch = await confirmedBatch(participantId);
  const [row] = await db
    .insert(predictions)
    .values({ participantId, questionId, outcome, batchId: batch.id })
    .returning();
  return row!;
}

describe("settlement executor", () => {
  it("settles a ready question and scores a correct confirmed prediction exactly once, stable on rerun", async () => {
    const chain = createStubChainAdapter();
    const fixtureId = await insertFixture();
    const question = await insertSettlingQuestion(fixtureId, chain);
    const participant = await insertParticipant();
    await insertConfirmedPrediction(question.id, participant.id, "yes");

    const executor = createSettlementExecutor({ db, chain });
    const first = await executor.runOnce();
    expect(first.settled).toBe(1);

    const [settledQuestion] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(settledQuestion!.status).toBe("settled");
    expect(settledQuestion!.result).toBe("yes");

    const [scoredParticipant] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, participant.id));
    expect(scoredParticipant!.points).toBe(1);
    expect(scoredParticipant!.currentStreak).toBe(1);
    expect(scoredParticipant!.bestStreak).toBe(1);

    // Rerun: question is no longer "settling", so it's not reselected —
    // points/streak/scored_at must be unchanged.
    const second = await executor.runOnce();
    expect(second.scanned).toBe(0);

    const [rowsAfter] = await db.select().from(predictions).where(eq(predictions.questionId, question.id));
    expect(rowsAfter!.scoredAt).not.toBeNull();
    const [participantAfter] = await db.select().from(participants).where(eq(participants.id, participant.id));
    expect(participantAfter!.points).toBe(1);
  });

  it("schedules a retry (not invented result) when fixture stats aren't ready yet", async () => {
    const chain = createStubChainAdapter();
    const fixtureId = await insertFixture({ stats: {} });
    const question = await insertSettlingQuestion(fixtureId, chain);

    const executor = createSettlementExecutor({ db, chain });
    const result = await executor.runOnce();
    expect(result.retried).toBe(1);

    const [row] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(row!.status).toBe("settling");
    expect(row!.result).toBeNull();
    expect(row!.attemptCount).toBeGreaterThan(0);
    expect(row!.nextRetryAt).not.toBeNull();
    expect(row!.lastError).not.toBeNull();
  });

  it("streak progression: correct, correct, push, incorrect, correct", async () => {
    const chain = createStubChainAdapter();
    const participant = await insertParticipant();

    async function settleOneOutcome(homeGoals: number, awayGoals: number, outcome: "yes" | "no") {
      const fixtureId = await insertFixture({
        id: `fx-${randomUUID().slice(0, 18)}`,
        stats: {
          full_time: {
            home: { goals: homeGoals, yellowCards: 0, redCards: 0, corners: 0 },
            away: { goals: awayGoals, yellowCards: 0, redCards: 0, corners: 0 },
          },
        },
      });
      const question = await insertSettlingQuestion(fixtureId, chain);
      await insertConfirmedPrediction(question.id, participant.id, outcome);
      const executor = createSettlementExecutor({ db, chain });
      await executor.runOnce();
      return question.id;
    }

    // correct (yes, home wins 2-1)
    await settleOneOutcome(2, 1, "yes");
    // correct (yes again)
    await settleOneOutcome(3, 0, "yes");
    // push (tie, predicting "yes" -> pushed regardless of outcome pick)
    await settleOneOutcome(1, 1, "yes");
    // incorrect (predicted yes but away wins)
    await settleOneOutcome(0, 1, "yes");
    // correct again
    await settleOneOutcome(2, 0, "yes");

    const [row] = await db.select().from(participants).where(eq(participants.id, participant.id));
    // streak: 1,2,(push preserves 2),(incorrect resets to 0),1
    expect(row!.currentStreak).toBe(1);
    expect(row!.bestStreak).toBe(2);
    expect(row!.points).toBe(3);
  });

  it("crash-repair: chain already settled but Postgres still settling", async () => {
    const chain = createStubChainAdapter();
    const fixtureId = await insertFixture();
    const question = await insertSettlingQuestion(fixtureId, chain);
    const participant = await insertParticipant();
    await insertConfirmedPrediction(question.id, participant.id, "yes");

    // Simulate a crash: settle directly on chain, leaving Postgres at "settling".
    await chain.settleQuestion({ questionPda: question.questionPda!, result: "yes" });

    const executor = createSettlementExecutor({ db, chain });
    const result = await executor.runOnce();
    expect(result.settled).toBe(1);

    const [row] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(row!.status).toBe("settled");
    expect(row!.result).toBe("yes");

    const [scoredParticipant] = await db.select().from(participants).where(eq(participants.id, participant.id));
    expect(scoredParticipant!.points).toBe(1);
  });

  it("concurrent claim: only one of two racing passes settles the question", async () => {
    const chain = createStubChainAdapter();
    const settleSpy = vi.spyOn(chain, "settleQuestion");
    const fixtureId = await insertFixture();
    const question = await insertSettlingQuestion(fixtureId, chain);

    const executorA = createSettlementExecutor({ db, chain });
    const executorB = createSettlementExecutor({ db, chain });

    const [a, b] = await Promise.all([executorA.runOnce(), executorB.runOnce()]);
    expect(a.settled + b.settled).toBe(1);
    expect(settleSpy).toHaveBeenCalledTimes(1);

    const [row] = await db.select().from(questions).where(eq(questions.id, question.id));
    expect(row!.status).toBe("settled");
  });

  it("logs console.error when processing a question overdue past 30 minutes", async () => {
    const chain = createStubChainAdapter();
    const fixtureId = await insertFixture();
    const question = await insertSettlingQuestion(fixtureId, chain, {
      settlingAt: minutesAgo(31),
    });
    void question;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const executor = createSettlementExecutor({ db, chain });
    await executor.runOnce();

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
