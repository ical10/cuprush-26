import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { createStubChainAdapter } from "../chain";
import { reconcilePendingBatches } from "../predictions/reconciler";
import { createApp } from "./app";
import { createDevAuthAdapter } from "./auth/dev";

const {
  agentCohorts,
  agents,
  agentDecisions,
  fixtures,
  participants,
  predictionBatches,
  predictions,
  questions,
  users,
} = schema;

const sql = postgres(testDatabaseUrl(), { max: 10 });
const db = drizzle(sql, { schema });

const chain = createStubChainAdapter();
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  app = createApp({ db, auth: createDevAuthAdapter({}) });
  warn.mockRestore();
});

afterAll(async () => {
  await sql.end();
});

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function base58Address() {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 43; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function cohortAuth(token: string, body?: unknown) {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

async function createOwnerUser() {
  const [participant] = await db.insert(participants).values({}).returning();
  const [user] = await db
    .insert(users)
    .values({ participantId: participant!.id, privyUserId: `did:privy:${randomUUID()}` })
    .returning();
  return user!;
}

async function createCohort(status: schema.AgentCohortStatus = "active") {
  const owner = await createOwnerUser();
  const token = `cohort-${randomUUID()}`;
  const [cohort] = await db
    .insert(agentCohorts)
    .values({
      ownerUserId: owner.id,
      name: `cohort-${randomUUID().slice(0, 8)}`,
      tokenHash: sha256(token),
      status,
    })
    .returning();
  return { cohort: cohort!, token };
}

async function createAgent(
  cohortId: string,
  opts: { status?: schema.AgentStatus; withWallet?: boolean } = {},
) {
  const { status = "active", withWallet = true } = opts;
  const [participant] = await db
    .insert(participants)
    .values({
      kind: "agent",
      walletAddress: withWallet ? base58Address() : null,
      displayName: "AI Bot",
    })
    .returning();
  const agentKey = `agent-${randomUUID().slice(0, 20)}`;
  const [agent] = await db
    .insert(agents)
    .values({
      participantId: participant!.id,
      cohortId,
      agentKey,
      persona: "cautious analyst",
      strategy: "value hunter",
      model: "claude-test",
      status,
    })
    .returning();
  return { participant: participant!, agent: agent!, agentKey };
}

type QuestionOverrides = Partial<typeof questions.$inferInsert>;

async function insertQuestion(
  overrides: QuestionOverrides = {},
  startsInMs = 90 * 60_000,
) {
  const now = Date.now();
  const fixtureId = `fx-${randomUUID().slice(0, 18)}`;
  await db.insert(fixtures).values({
    id: fixtureId,
    homeTeam: "Argentina",
    awayTeam: "France",
    startsAt: new Date(now + startsInMs),
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
      status: "open",
      opensAt: new Date(now - 60 * 60_000),
      locksAt: new Date(now + 60 * 60_000),
      ruleHash: randomBytes(32).toString("hex"),
      ...overrides,
    })
    .returning();
  return question!;
}

async function ensureTestBatch(participantId: string, fixtureId: string) {
  const [existing] = await db
    .select()
    .from(predictionBatches)
    .where(
      and(
        eq(predictionBatches.participantId, participantId),
        eq(predictionBatches.fixtureId, fixtureId),
      ),
    );
  if (existing) return existing;
  const [created] = await db
    .insert(predictionBatches)
    .values({ participantId, fixtureId, batchHash: "0".repeat(64) })
    .returning();
  return created!;
}

/** A settled question the participant already predicted — feeds history. */
async function insertSettledPrediction(
  participantId: string,
  opts: { outcome?: string; result?: "yes" | "no" } = {},
) {
  const { outcome = "yes", result = "yes" } = opts;
  const question = await insertQuestion({ status: "settled", result });
  const batch = await ensureTestBatch(participantId, question.fixtureId);
  await db.insert(predictions).values({
    participantId,
    questionId: question.id,
    outcome: outcome as "yes" | "no" | "higher" | "lower",
    batchId: batch.id,
  });
  return question;
}

function pending(token: string) {
  return app.request("/api/cohort/pending", cohortAuth(token, {}));
}

function submit(token: string, decisions: unknown) {
  return app.request("/api/cohort/decisions", cohortAuth(token, decisions));
}

// --- auth -------------------------------------------------------------------

describe("cohort auth", () => {
  it("rejects a missing token with 401", async () => {
    const res = await app.request("/api/cohort/pending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown token with 401", async () => {
    const res = await pending(`cohort-${randomUUID()}`);
    expect(res.status).toBe(401);
  });

  it("rejects a paused cohort with 403", async () => {
    const { token } = await createCohort("paused");
    const res = await pending(token);
    expect(res.status).toBe(403);
  });

  it("rejects a revoked cohort with 403", async () => {
    const { token } = await createCohort("revoked");
    const res = await pending(token);
    expect(res.status).toBe(403);
  });

  it("accepts an active cohort token", async () => {
    const { token } = await createCohort("active");
    const res = await pending(token);
    expect(res.status).toBe(200);
  });
});

// --- pending ----------------------------------------------------------------

describe("POST /api/cohort/pending", () => {
  it("returns active players with persona, strategy, history, and open work", async () => {
    const { cohort, token } = await createCohort();
    const { participant, agentKey } = await createAgent(cohort.id);
    await insertSettledPrediction(participant.id, { outcome: "yes", result: "yes" });
    await insertSettledPrediction(participant.id, { outcome: "yes", result: "no" });
    const open = await insertQuestion();

    const res = await pending(token);
    expect(res.status).toBe(200);
    const body: {
      players: {
        agent_key: string;
        persona: string;
        strategy: string;
        history: { template: string; outcome: string; correct: boolean | null }[];
        open_questions: { id: string; question: string; outcomes: string[]; locks_at: string }[];
      }[];
    } = await res.json();

    const player = body.players.find((p) => p.agent_key === agentKey);
    expect(player).toBeDefined();
    expect(player!.persona).toBe("cautious analyst");
    expect(player!.strategy).toBe("value hunter");
    expect(player!.history).toHaveLength(2);
    expect(player!.history.map((h) => h.correct).sort()).toEqual([false, true]);

    const openIds = player!.open_questions.map((q) => q.id);
    expect(openIds).toContain(open.id);
    const card = player!.open_questions.find((q) => q.id === open.id)!;
    expect(card.question).toContain("Argentina");
    expect(card.outcomes).toEqual(["yes", "no"]);
  });

  it("excludes questions the player already answered", async () => {
    const { cohort, token } = await createCohort();
    const { participant, agentKey } = await createAgent(cohort.id);
    const answered = await insertQuestion();
    const batch = await ensureTestBatch(participant.id, answered.fixtureId);
    await db.insert(predictions).values({
      participantId: participant.id,
      questionId: answered.id,
      outcome: "yes",
      batchId: batch.id,
    });

    const res = await pending(token);
    const body: { players: { agent_key: string; open_questions: { id: string }[] }[] } =
      await res.json();
    const player = body.players.find((p) => p.agent_key === agentKey)!;
    expect(player.open_questions.map((q) => q.id)).not.toContain(answered.id);
  });

  it("excludes questions within 2 minutes of lock", async () => {
    const { cohort, token } = await createCohort();
    const { agentKey } = await createAgent(cohort.id);
    // locks in 1 minute -> inside the 2-minute margin -> excluded.
    const nearLock = await insertQuestion({
      locksAt: new Date(Date.now() + 60_000),
    });
    const farLock = await insertQuestion();

    const res = await pending(token);
    const body: { players: { agent_key: string; open_questions: { id: string }[] }[] } =
      await res.json();
    const player = body.players.find((p) => p.agent_key === agentKey)!;
    const ids = player.open_questions.map((q) => q.id);
    expect(ids).not.toContain(nearLock.id);
    expect(ids).toContain(farLock.id);
  });

  it("caps open questions per player at the pending limit, soonest lock first", async () => {
    const { cohort, token } = await createCohort();
    const { agentKey } = await createAgent(cohort.id);
    const soonest = await insertQuestion({
      locksAt: new Date(Date.now() + 10 * 60_000),
    });
    for (let k = 0; k < 21; k++) {
      await insertQuestion({ locksAt: new Date(Date.now() + (30 + k) * 60_000) });
    }

    const res = await pending(token);
    const body: { players: { agent_key: string; open_questions: { id: string }[] }[] } =
      await res.json();
    const player = body.players.find((p) => p.agent_key === agentKey)!;
    expect(player.open_questions.length).toBe(20);
    expect(player.open_questions[0]!.id).toBe(soonest.id);
  });

  it("excludes paused agents from the player list", async () => {
    const { cohort, token } = await createCohort();
    const active = await createAgent(cohort.id, { status: "active" });
    const paused = await createAgent(cohort.id, { status: "paused" });

    const res = await pending(token);
    const body: { players: { agent_key: string }[] } = await res.json();
    const keys = body.players.map((p) => p.agent_key);
    expect(keys).toContain(active.agentKey);
    expect(keys).not.toContain(paused.agentKey);
  });
});

// --- submit -----------------------------------------------------------------

describe("POST /api/cohort/decisions", () => {
  it("happy path: stores a decision + prediction, committed on chain at lock", async () => {
    const { cohort, token } = await createCohort();
    const { participant, agentKey } = await createAgent(cohort.id);
    const question = await insertQuestion();

    const res = await submit(token, [
      {
        agent_key: agentKey,
        question_id: question.id,
        outcome: "yes",
        confidence: 0.72,
        rationale: "home side dominates possession",
      },
    ]);
    expect(res.status).toBe(200);
    const body: { results: { ok: boolean; predictionId?: string }[] } = await res.json();
    expect(body.results[0]!.ok).toBe(true);
    const predictionId = body.results[0]!.predictionId!;

    const [prediction] = await db
      .select()
      .from(predictions)
      .where(eq(predictions.id, predictionId));
    expect(prediction!.participantId).toBe(participant.id);
    expect(prediction!.questionId).toBe(question.id);
    expect(prediction!.outcome).toBe("yes");

    const [decision] = await db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.participantId, participant.id),
          eq(agentDecisions.questionId, question.id),
        ),
      );
    expect(decision!.rationale).toBe("home side dominates possession");
    expect(Number(decision!.confidence)).toBeCloseTo(0.72);

    // The decisions route stores the batch pending with a current hash and
    // never submits on chain. The reconciler commits it once the fixture
    // locks (kickoff-30m).
    const [batch] = await db
      .select()
      .from(predictionBatches)
      .where(eq(predictionBatches.participantId, participant.id));
    expect(batch!.chainStatus).toBe("pending");

    await reconcilePendingBatches(db, chain, new Date(Date.now() + 61 * 60_000));
    const [committed] = await db
      .select()
      .from(predictionBatches)
      .where(eq(predictionBatches.id, batch!.id));
    expect(committed!.chainStatus).toBe("confirmed");
    const onChain = await chain.getBatch(
      participant.walletAddress!,
      committed!.fixtureId,
    );
    expect(onChain?.batchHash).toBe(committed!.batchHash);
  });

  it("rejects an agent_key that belongs to another cohort", async () => {
    const cohortA = await createCohort();
    const cohortB = await createCohort();
    const foreign = await createAgent(cohortB.cohort.id);
    const question = await insertQuestion();

    const res = await submit(cohortA.token, [
      {
        agent_key: foreign.agentKey,
        question_id: question.id,
        outcome: "yes",
        confidence: 0.5,
        rationale: "forged",
      },
    ]);
    expect(res.status).toBe(200);
    const body: { results: { ok: boolean; error?: string }[] } = await res.json();
    expect(body.results[0]).toMatchObject({ ok: false, error: "unknown_agent" });

    // Nothing was written for the foreign participant.
    const rows = await db
      .select()
      .from(predictions)
      .where(eq(predictions.participantId, foreign.participant.id));
    expect(rows).toHaveLength(0);
  });

  it("rejects an outcome that does not fit the question template", async () => {
    const { cohort, token } = await createCohort();
    const { agentKey } = await createAgent(cohort.id);
    const question = await insertQuestion(); // winner: yes/no

    const res = await submit(token, [
      { agent_key: agentKey, question_id: question.id, outcome: "higher", confidence: 0.5, rationale: "x" },
    ]);
    const body: { results: { ok: boolean; error?: string }[] } = await res.json();
    expect(body.results[0]).toMatchObject({ ok: false, error: "invalid_outcome" });
  });

  it("rejects out-of-range confidence", async () => {
    const { cohort, token } = await createCohort();
    const { agentKey } = await createAgent(cohort.id);
    const question = await insertQuestion();

    for (const confidence of [1.5, -0.1]) {
      const res = await submit(token, [
        { agent_key: agentKey, question_id: question.id, outcome: "yes", confidence, rationale: "x" },
      ]);
      const body: { results: { ok: boolean; error?: string }[] } = await res.json();
      expect(body.results[0]).toMatchObject({ ok: false, error: "invalid_confidence" });
    }
  });

  it("rejects a rationale longer than 280 characters", async () => {
    const { cohort, token } = await createCohort();
    const { agentKey } = await createAgent(cohort.id);
    const question = await insertQuestion();

    const res = await submit(token, [
      {
        agent_key: agentKey,
        question_id: question.id,
        outcome: "yes",
        confidence: 0.5,
        rationale: "z".repeat(281),
      },
    ]);
    const body: { results: { ok: boolean; error?: string }[] } = await res.json();
    expect(body.results[0]).toMatchObject({ ok: false, error: "invalid_rationale" });
  });

  it("rejects a question inside the 2-minute lock margin", async () => {
    const { cohort, token } = await createCohort();
    const { agentKey } = await createAgent(cohort.id);
    const question = await insertQuestion({ locksAt: new Date(Date.now() + 60_000) });

    const res = await submit(token, [
      { agent_key: agentKey, question_id: question.id, outcome: "yes", confidence: 0.5, rationale: "x" },
    ]);
    const body: { results: { ok: boolean; error?: string }[] } = await res.json();
    expect(body.results[0]).toMatchObject({ ok: false, error: "locked" });
  });

  it("is idempotent: a duplicate returns the existing id and writes no second row", async () => {
    const { cohort, token } = await createCohort();
    const { participant, agentKey } = await createAgent(cohort.id);
    const question = await insertQuestion();
    const decision = {
      agent_key: agentKey,
      question_id: question.id,
      outcome: "yes",
      confidence: 0.6,
      rationale: "first",
    };

    const first = await submit(token, [decision]);
    const firstBody: { results: { ok: boolean; predictionId?: string }[] } = await first.json();
    const id = firstBody.results[0]!.predictionId!;

    const second = await submit(token, [{ ...decision, rationale: "second" }]);
    const secondBody: { results: { ok: boolean; predictionId?: string }[] } = await second.json();
    expect(secondBody.results[0]!.ok).toBe(true);
    expect(secondBody.results[0]!.predictionId).toBe(id);

    const predRows = await db
      .select()
      .from(predictions)
      .where(
        and(
          eq(predictions.participantId, participant.id),
          eq(predictions.questionId, question.id),
        ),
      );
    expect(predRows).toHaveLength(1);
    const decisionRows = await db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.participantId, participant.id),
          eq(agentDecisions.questionId, question.id),
        ),
      );
    expect(decisionRows).toHaveLength(1);
    expect(decisionRows[0]!.rationale).toBe("first");
  });

  it("partial batch: one bad item does not sink the valid ones", async () => {
    const { cohort, token } = await createCohort();
    const { participant, agentKey } = await createAgent(cohort.id);
    const good = await insertQuestion();
    const bad = await insertQuestion();

    const res = await submit(token, [
      { agent_key: agentKey, question_id: good.id, outcome: "yes", confidence: 0.5, rationale: "ok" },
      { agent_key: agentKey, question_id: bad.id, outcome: "higher", confidence: 0.5, rationale: "bad" },
    ]);
    const body: { results: { ok: boolean; error?: string; predictionId?: string }[] } =
      await res.json();
    expect(body.results[0]!.ok).toBe(true);
    expect(body.results[1]).toMatchObject({ ok: false, error: "invalid_outcome" });

    const goodRows = await db
      .select()
      .from(predictions)
      .where(
        and(
          eq(predictions.participantId, participant.id),
          eq(predictions.questionId, good.id),
        ),
      );
    expect(goodRows).toHaveLength(1);
    const badRows = await db
      .select()
      .from(predictions)
      .where(
        and(
          eq(predictions.participantId, participant.id),
          eq(predictions.questionId, bad.id),
        ),
      );
    expect(badRows).toHaveLength(0);
  });

  it("rejects a non-array body with 400", async () => {
    const { token } = await createCohort();
    const res = await submit(token, { not: "an array" });
    expect(res.status).toBe(400);
  });
});
