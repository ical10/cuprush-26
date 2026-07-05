import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./test/test-db";
import {
  fixtures,
  participants,
  predictionBatches,
  predictions,
  questions,
  users,
} from "./schema";

const sql = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(sql, {
  schema: { fixtures, participants, predictionBatches, predictions, questions, users },
});

async function insertBatch(participantId: string) {
  const [row] = await db
    .insert(predictionBatches)
    .values({ participantId, batchHash: `hash-${randomUUID()}` })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

afterAll(async () => {
  await sql.end();
});

async function insertParticipant(overrides: Partial<typeof participants.$inferInsert> = {}) {
  const [row] = await db
    .insert(participants)
    .values({ kind: "human", ...overrides })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

async function insertFixture(id: string) {
  await db.insert(fixtures).values({
    id,
    homeTeam: "Team A",
    awayTeam: "Team B",
    startsAt: new Date(),
  });
}

async function insertQuestion(fixtureId: string, ruleHash: string) {
  const [row] = await db
    .insert(questions)
    .values({
      fixtureId,
      template: "winner",
      statKey1: "goals",
      statKey2: "goals",
      operator: "subtract",
      comparison: "greater_than",
      threshold: 0,
      opensAt: new Date(),
      locksAt: new Date(),
      ruleHash,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

describe("migrations", () => {
  it("create the core tables", async () => {
    const rows = await sql<{ table_name: string }[]>`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    const tableNames = rows.map((r) => r.table_name).sort();
    expect(tableNames).toEqual(
      [
        "fixtures",
        "participants",
        "prediction_batches",
        "predictions",
        "questions",
        "users",
      ].sort(),
    );
  });
});

describe("prediction_batches constraints", () => {
  it("enforces one batch per participant", async () => {
    const participant = await insertParticipant();
    await insertBatch(participant.id);
    await expect(insertBatch(participant.id)).rejects.toThrow();
  });

  it("rejects a negative attempt_count", async () => {
    const participant = await insertParticipant();
    await expect(
      db.insert(predictionBatches).values({
        participantId: participant.id,
        batchHash: "hash",
        attemptCount: -1,
      }),
    ).rejects.toThrow();
  });
});

describe("participants constraints", () => {
  it("rejects negative points", async () => {
    await expect(
      db.insert(participants).values({ kind: "human", points: -1 }),
    ).rejects.toThrow();
  });

  it("rejects negative current_streak", async () => {
    await expect(
      db.insert(participants).values({ kind: "human", currentStreak: -1 }),
    ).rejects.toThrow();
  });

  it("rejects negative best_streak", async () => {
    await expect(
      db.insert(participants).values({ kind: "human", bestStreak: -1 }),
    ).rejects.toThrow();
  });

  it("enforces unique wallet_address", async () => {
    const wallet = `Wallet${randomUUID().replace(/-/g, "")}`.slice(0, 44);
    await insertParticipant({ walletAddress: wallet });
    await expect(insertParticipant({ walletAddress: wallet })).rejects.toThrow();
  });

  it("allows multiple participants with a null wallet_address", async () => {
    await insertParticipant();
    await expect(insertParticipant()).resolves.toBeDefined();
  });
});

describe("users constraints", () => {
  it("enforces unique privy_user_id", async () => {
    const p1 = await insertParticipant();
    const p2 = await insertParticipant();
    const privyUserId = `privy-${randomUUID()}`;
    await db.insert(users).values({ participantId: p1.id, privyUserId });
    await expect(
      db.insert(users).values({ participantId: p2.id, privyUserId }),
    ).rejects.toThrow();
  });

  it("enforces unique participant_id", async () => {
    const p1 = await insertParticipant();
    await db.insert(users).values({ participantId: p1.id, privyUserId: `privy-${randomUUID()}` });
    await expect(
      db.insert(users).values({ participantId: p1.id, privyUserId: `privy-${randomUUID()}` }),
    ).rejects.toThrow();
  });
});

describe("questions constraints", () => {
  it("enforces unique rule_hash", async () => {
    const fixtureId = `fixture-${randomUUID()}`;
    await insertFixture(fixtureId);
    const ruleHash = `rule-${randomUUID()}`;
    await insertQuestion(fixtureId, ruleHash);

    await expect(insertQuestion(fixtureId, ruleHash)).rejects.toThrow();
  });

  it("rejects a negative attempt_count", async () => {
    const fixtureId = `fixture-${randomUUID()}`;
    await insertFixture(fixtureId);

    await expect(
      db.insert(questions).values({
        fixtureId,
        template: "winner",
        statKey1: "goals",
        statKey2: "goals",
        operator: "subtract",
        comparison: "greater_than",
        threshold: 0,
        opensAt: new Date(),
        locksAt: new Date(),
        ruleHash: `rule-${randomUUID()}`,
        attemptCount: -1,
      }),
    ).rejects.toThrow();
  });
});

describe("predictions constraints", () => {
  it("enforces unique (participant_id, question_id)", async () => {
    const participant = await insertParticipant();
    const fixtureId = `fixture-${randomUUID()}`;
    await insertFixture(fixtureId);
    const question = await insertQuestion(fixtureId, `rule-${randomUUID()}`);
    const batch = await insertBatch(participant.id);

    await db.insert(predictions).values({
      participantId: participant.id,
      questionId: question.id,
      outcome: "yes",
      batchId: batch.id,
    });

    await expect(
      db.insert(predictions).values({
        participantId: participant.id,
        questionId: question.id,
        outcome: "no",
        batchId: batch.id,
      }),
    ).rejects.toThrow();
  });

  it("restricts deleting a participant that has predictions", async () => {
    const participant = await insertParticipant();
    const fixtureId = `fixture-${randomUUID()}`;
    await insertFixture(fixtureId);
    const question = await insertQuestion(fixtureId, `rule-${randomUUID()}`);
    const batch = await insertBatch(participant.id);

    await db.insert(predictions).values({
      participantId: participant.id,
      questionId: question.id,
      outcome: "yes",
      batchId: batch.id,
    });

    await expect(
      db.delete(participants).where(eq(participants.id, participant.id)),
    ).rejects.toThrow();
  });
});
