import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "./test/test-db";
import {
  agentCohorts,
  agentDecisions,
  agents,
  fixtures,
  participants,
  predictionBatches,
  predictions,
  questions,
  users,
} from "./schema";

const sql = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(sql, {
  schema: {
    agentCohorts,
    agentDecisions,
    agents,
    fixtures,
    participants,
    predictionBatches,
    predictions,
    questions,
    users,
  },
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

async function insertUser(participantId: string) {
  const [row] = await db
    .insert(users)
    .values({ participantId, privyUserId: `privy-${randomUUID()}` })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

async function insertCohort(overrides: Partial<typeof agentCohorts.$inferInsert> = {}) {
  const owner = await insertParticipant();
  const ownerUser = await insertUser(owner.id);
  const [row] = await db
    .insert(agentCohorts)
    .values({ ownerUserId: ownerUser.id, name: `cohort-${randomUUID()}`, ...overrides })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

async function insertAgent(overrides: Partial<typeof agents.$inferInsert> = {}) {
  const cohort = overrides.cohortId
    ? { id: overrides.cohortId }
    : await insertCohort();
  const participant = await insertParticipant({ kind: "agent" });
  const [row] = await db
    .insert(agents)
    .values({
      participantId: participant.id,
      cohortId: cohort.id,
      agentKey: `agent-${randomUUID()}`.slice(0, 32),
      persona: "Weights recent form heavily.",
      strategy: "Prefer the strongest recent form.",
      model: "pinned-model-id",
      ...overrides,
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
        "agent_cohorts",
        "agent_decisions",
        "agents",
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

describe("participants kind default", () => {
  it("defaults kind to 'human' when unspecified", async () => {
    const [row] = await db.insert(participants).values({}).returning();
    if (!row) throw new Error("insert failed");
    expect(row.kind).toBe("human");
  });
});

describe("agent_cohorts constraints", () => {
  it("enforces unique token_hash", async () => {
    const tokenHash = `hash-${randomUUID()}`;
    await insertCohort({ tokenHash });
    await expect(insertCohort({ tokenHash })).rejects.toThrow();
  });

  it("allows multiple cohorts with a null token_hash", async () => {
    await insertCohort();
    await expect(insertCohort()).resolves.toBeDefined();
  });
});

describe("agents constraints", () => {
  it("enforces unique agent_key", async () => {
    const agentKey = `key-${randomUUID()}`.slice(0, 32);
    await insertAgent({ agentKey });
    await expect(insertAgent({ agentKey })).rejects.toThrow();
  });

  it("enforces unique privy_wallet_id", async () => {
    const walletId = `wallet-${randomUUID()}`.slice(0, 64);
    await insertAgent({ privyWalletId: walletId });
    await expect(insertAgent({ privyWalletId: walletId })).rejects.toThrow();
  });

  it("allows multiple agents with a null privy_wallet_id", async () => {
    await insertAgent();
    await expect(insertAgent()).resolves.toBeDefined();
  });

  it("restricts deleting a participant that backs an agent", async () => {
    const agent = await insertAgent();
    await expect(
      db.delete(participants).where(eq(participants.id, agent.participantId)),
    ).rejects.toThrow();
  });
});

describe("agent_decisions constraints", () => {
  async function seedDecisionContext() {
    const agent = await insertAgent();
    const fixtureId = `fixture-${randomUUID()}`;
    await insertFixture(fixtureId);
    const question = await insertQuestion(fixtureId, `rule-${randomUUID()}`);
    return { participantId: agent.participantId, questionId: question.id };
  }

  it("enforces unique (participant_id, question_id)", async () => {
    const { participantId, questionId } = await seedDecisionContext();
    await db.insert(agentDecisions).values({
      participantId,
      questionId,
      outcome: "higher",
      confidence: "0.72",
      rationale: "Recent form favors the reference team.",
    });

    await expect(
      db.insert(agentDecisions).values({
        participantId,
        questionId,
        outcome: "lower",
        confidence: "0.4",
        rationale: "Second attempt for the same pair.",
      }),
    ).rejects.toThrow();
  });

  it("rejects confidence above 1", async () => {
    const { participantId, questionId } = await seedDecisionContext();
    await expect(
      db.insert(agentDecisions).values({
        participantId,
        questionId,
        outcome: "higher",
        confidence: "1.5",
        rationale: "Out of range high.",
      }),
    ).rejects.toThrow();
  });

  it("rejects confidence below 0", async () => {
    const { participantId, questionId } = await seedDecisionContext();
    await expect(
      db.insert(agentDecisions).values({
        participantId,
        questionId,
        outcome: "higher",
        confidence: "-0.1",
        rationale: "Out of range low.",
      }),
    ).rejects.toThrow();
  });

  it("accepts confidence at the 0 and 1 bounds", async () => {
    const low = await seedDecisionContext();
    await expect(
      db.insert(agentDecisions).values({
        participantId: low.participantId,
        questionId: low.questionId,
        outcome: "no",
        confidence: "0",
        rationale: "Lower bound.",
      }),
    ).resolves.toBeDefined();

    const high = await seedDecisionContext();
    await expect(
      db.insert(agentDecisions).values({
        participantId: high.participantId,
        questionId: high.questionId,
        outcome: "yes",
        confidence: "1",
        rationale: "Upper bound.",
      }),
    ).resolves.toBeDefined();
  });

  it("restricts deleting a participant that has decisions", async () => {
    const { participantId, questionId } = await seedDecisionContext();
    await db.insert(agentDecisions).values({
      participantId,
      questionId,
      outcome: "higher",
      confidence: "0.6",
      rationale: "Keeps the participant pinned.",
    });

    await expect(
      db.delete(participants).where(eq(participants.id, participantId)),
    ).rejects.toThrow();
  });
});
