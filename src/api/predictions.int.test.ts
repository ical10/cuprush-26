import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { ChainError, createStubChainAdapter, type ChainAdapter } from "../chain";
import {
  reconcilePendingPredictions,
  submitPendingPrediction,
} from "../predictions/reconciler";
import { createApp } from "./app";
import { createDevAuthAdapter } from "./auth/dev";

const { fixtures, predictions, questions, users } = schema;
const sql = postgres(testDatabaseUrl(), { max: 10 });
const db = drizzle(sql, { schema });

// One shared stub chain + app for most tests; per-test adapters are built
// where a test needs failure injection or its own chain state.
const chain = createStubChainAdapter();
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  app = createApp({ db, auth: createDevAuthAdapter({}), chain });
  warn.mockRestore();
});

afterAll(async () => {
  await sql.end();
});

function devToken() {
  return `dev:test-${randomUUID()}`;
}

function authed(token: string, init: RequestInit = {}) {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  };
}

function base58Address() {
  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 43; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** Provisions a participant with a wallet; returns its token + ids. */
async function participantWithWallet(appInstance = app) {
  const token = devToken();
  const address = base58Address();
  const res = await appInstance.request(
    "/api/wallet",
    authed(token, { method: "POST", body: JSON.stringify({ address }) }),
  );
  expect(res.status).toBe(200);

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.privyUserId, token.slice("dev:".length)));
  return { token, wallet: address, participantId: user!.participantId };
}

type QuestionOverrides = Partial<typeof questions.$inferInsert>;

/** Inserts a fixture + one open winner question (opens_at past, locks_at future). */
async function insertOpenQuestion(overrides: QuestionOverrides = {}) {
  const now = Date.now();
  const fixtureId = `fx-${randomUUID().slice(0, 18)}`;
  await db.insert(fixtures).values({
    id: fixtureId,
    homeTeam: "Argentina",
    awayTeam: "France",
    startsAt: new Date(now + 90 * 60_000),
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

function postPrediction(
  token: string,
  body: unknown,
  appInstance = app,
) {
  return appInstance.request(
    "/api/predictions",
    authed(token, { method: "POST", body: JSON.stringify(body) }),
  );
}

async function predictionRow(id: string) {
  const [row] = await db.select().from(predictions).where(eq(predictions.id, id));
  return row!;
}

/** A stub whose submitPrediction fails `failures` times, then delegates. */
function failingChain(failures: number): ChainAdapter {
  const inner = createStubChainAdapter();
  let remaining = failures;
  return {
    ...inner,
    submitPrediction(input) {
      if (remaining > 0) {
        remaining -= 1;
        return Promise.reject(new ChainError("not_configured", "rpc unavailable"));
      }
      return inner.submitPrediction(input);
    },
  };
}

describe("POST /api/predictions", () => {
  it("happy path: pending row confirmed with PDA + signature, question PDA persisted", async () => {
    const { token } = await participantWithWallet();
    const question = await insertOpenQuestion();

    const res = await postPrediction(token, {
      questionId: question.id,
      outcome: "yes",
    });
    expect(res.status).toBe(201);

    const body: {
      id: string;
      chainStatus: string;
      predictionPda: string | null;
      signature: string | null;
    } = await res.json();
    expect(body.chainStatus).toBe("confirmed");
    expect(body.predictionPda).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    expect(body.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);

    const row = await predictionRow(body.id);
    expect(row.chainStatus).toBe("confirmed");
    expect(row.submittedAt).not.toBeNull();
    expect(row.confirmedAt).not.toBeNull();

    // The chain really holds the prediction at the deterministic PDA.
    const onChain = await chain.getPrediction(body.predictionPda!);
    expect(onChain?.outcome).toBe("yes");

    // ensureQuestionOnChain recorded the Question PDA on the questions row.
    const [questionAfter] = await db
      .select()
      .from(questions)
      .where(eq(questions.id, question.id));
    expect(questionAfter!.questionPda).toBe(
      chain.deriveQuestionPda(question.ruleHash),
    );
  });

  it("duplicate POST returns the same row, never a second chain submission or a changed answer", async () => {
    const { token } = await participantWithWallet();
    const question = await insertOpenQuestion();
    const spy = vi.spyOn(chain, "submitPrediction");

    const first = await postPrediction(token, {
      questionId: question.id,
      outcome: "yes",
    });
    expect(first.status).toBe(201);
    const firstBody: { id: string; outcome: string } = await first.json();
    const callsAfterFirst = spy.mock.calls.length;

    const second = await postPrediction(token, {
      questionId: question.id,
      outcome: "no", // attempt to change the answer
    });
    expect(second.status).toBe(200);
    const secondBody: { id: string; outcome: string } = await second.json();

    expect(secondBody.id).toBe(firstBody.id);
    expect(secondBody.outcome).toBe("yes");
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
    spy.mockRestore();
  });

  it("rejects a locked question with 409", async () => {
    const { token } = await participantWithWallet();
    const now = Date.now();
    const question = await insertOpenQuestion({
      status: "locked",
      opensAt: new Date(now - 2 * 60 * 60_000),
      locksAt: new Date(now - 60_000),
    });

    const res = await postPrediction(token, {
      questionId: question.id,
      outcome: "yes",
    });
    expect(res.status).toBe(409);
  });

  it("rejects an unopened (scheduled) question with 409", async () => {
    const { token } = await participantWithWallet();
    const now = Date.now();
    const question = await insertOpenQuestion({
      status: "scheduled",
      opensAt: new Date(now + 60 * 60_000),
      locksAt: new Date(now + 2 * 60 * 60_000),
    });

    const res = await postPrediction(token, {
      questionId: question.id,
      outcome: "yes",
    });
    expect(res.status).toBe(409);
  });

  it("rejects a stale 'open' status past locks_at with 409 (window is authoritative)", async () => {
    const { token } = await participantWithWallet();
    const now = Date.now();
    const question = await insertOpenQuestion({
      status: "open",
      opensAt: new Date(now - 2 * 60 * 60_000),
      locksAt: new Date(now - 60_000), // scheduler tick hasn't locked it yet
    });

    const res = await postPrediction(token, {
      questionId: question.id,
      outcome: "yes",
    });
    expect(res.status).toBe(409);
  });

  it("rejects an outcome that does not fit the question type with 422", async () => {
    const { token } = await participantWithWallet();
    const question = await insertOpenQuestion(); // winner: yes/no

    const res = await postPrediction(token, {
      questionId: question.id,
      outcome: "higher",
    });
    expect(res.status).toBe(422);
  });

  it("rejects a participant without a wallet with 400", async () => {
    const token = devToken();
    await app.request("/api/me", authed(token)); // provision, no wallet
    const question = await insertOpenQuestion();

    const res = await postPrediction(token, {
      questionId: question.id,
      outcome: "yes",
    });
    expect(res.status).toBe(400);
    const rows = await db
      .select()
      .from(predictions)
      .where(eq(predictions.questionId, question.id));
    expect(rows).toHaveLength(0);
  });

  it("rejects a participant who revoked delegation with 403", async () => {
    const { token } = await participantWithWallet();
    await app.request(
      "/api/wallet/delegation/revoke",
      authed(token, { method: "POST" }),
    );
    const question = await insertOpenQuestion();

    const res = await postPrediction(token, {
      questionId: question.id,
      outcome: "yes",
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown question", async () => {
    const { token } = await participantWithWallet();
    const res = await postPrediction(token, {
      questionId: randomUUID(),
      outcome: "yes",
    });
    expect(res.status).toBe(404);
  });

  it("rejects an invalid body with 400", async () => {
    const { token } = await participantWithWallet();
    for (const body of [
      {},
      { questionId: "not-a-uuid", outcome: "yes" },
      { questionId: randomUUID(), outcome: "maybe" },
      { questionId: randomUUID(), outcome: "yes", extra: 1 },
    ]) {
      const res = await postPrediction(token, body);
      expect(res.status).toBe(400);
    }
  });

  it("requires authentication", async () => {
    const res = await app.request("/api/predictions", {
      method: "POST",
      body: JSON.stringify({ questionId: randomUUID(), outcome: "yes" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("caps submissions per participant per minute with 429", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limitedApp = createApp({
      db,
      auth: createDevAuthAdapter({}),
      chain: createStubChainAdapter(),
      predictions: { rateLimit: { limit: 2, windowMs: 60_000 } },
    });
    warn.mockRestore();

    const { token } = await participantWithWallet(limitedApp);
    const questionA = await insertOpenQuestion();
    const questionB = await insertOpenQuestion();
    const questionC = await insertOpenQuestion();

    const first = await postPrediction(
      token,
      { questionId: questionA.id, outcome: "yes" },
      limitedApp,
    );
    expect(first.status).toBe(201);
    const second = await postPrediction(
      token,
      { questionId: questionB.id, outcome: "yes" },
      limitedApp,
    );
    expect(second.status).toBe(201);
    const third = await postPrediction(
      token,
      { questionId: questionC.id, outcome: "yes" },
      limitedApp,
    );
    expect(third.status).toBe(429);
  });

  it("leaves the row pending with a scheduled retry when the chain submit fails", async () => {
    const flaky = failingChain(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flakyApp = createApp({ db, auth: createDevAuthAdapter({}), chain: flaky });
    warn.mockRestore();

    const { token } = await participantWithWallet(flakyApp);
    const question = await insertOpenQuestion();

    const res = await postPrediction(
      token,
      { questionId: question.id, outcome: "yes" },
      flakyApp,
    );
    expect(res.status).toBe(201);
    const body: { id: string; chainStatus: string } = await res.json();
    expect(body.chainStatus).toBe("pending");

    const row = await predictionRow(body.id);
    expect(row.chainStatus).toBe("pending");
    expect(row.attemptCount).toBe(1);
    expect(row.nextRetryAt).not.toBeNull();
    expect(row.lastError).toContain("rpc unavailable");
  });
});

describe("GET /api/predictions", () => {
  it("lists only the caller's predictions with question info and chain status", async () => {
    const mine = await participantWithWallet();
    const theirs = await participantWithWallet();
    const question = await insertOpenQuestion();

    await postPrediction(mine.token, { questionId: question.id, outcome: "yes" });
    await postPrediction(theirs.token, { questionId: question.id, outcome: "no" });

    const res = await app.request("/api/predictions", authed(mine.token));
    expect(res.status).toBe(200);
    const rows: {
      questionId: string;
      outcome: string;
      chainStatus: string;
      question: { id: string; template: string; fixtureId: string };
    }[] = await res.json();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      questionId: question.id,
      outcome: "yes",
      chainStatus: "confirmed",
    });
    expect(rows[0]!.question).toMatchObject({
      id: question.id,
      template: "winner",
      fixtureId: question.fixtureId,
    });
  });

  it("requires authentication", async () => {
    const res = await app.request("/api/predictions");
    expect(res.status).toBe(401);
  });
});

describe("prediction reconciler", () => {
  it("confirms a pending row on retry after a transient chain failure", async () => {
    const flaky = failingChain(1);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const flakyApp = createApp({ db, auth: createDevAuthAdapter({}), chain: flaky });
    warn.mockRestore();

    const { token } = await participantWithWallet(flakyApp);
    const question = await insertOpenQuestion();
    const res = await postPrediction(
      token,
      { questionId: question.id, outcome: "yes" },
      flakyApp,
    );
    const body: { id: string } = await res.json();
    expect((await predictionRow(body.id)).chainStatus).toBe("pending");

    // Not due yet: a tick before next_retry_at must not touch the row.
    await reconcilePendingPredictions(db, flaky, new Date());
    expect((await predictionRow(body.id)).chainStatus).toBe("pending");

    // Due: one backoff step later the retry succeeds.
    const afterBackoff = new Date(Date.now() + 2 * 60_000);
    await reconcilePendingPredictions(db, flaky, afterBackoff);

    const row = await predictionRow(body.id);
    expect(row.chainStatus).toBe("confirmed");
    expect(row.predictionPda).not.toBeNull();
    expect(row.signature).not.toBeNull();
    expect(row.nextRetryAt).toBeNull();
    expect(row.lastError).toBeNull();
  });

  it("fails a pending prediction once its question locks", async () => {
    const adapter = createStubChainAdapter();
    const { participantId } = await participantWithWallet();
    const now = Date.now();
    const question = await insertOpenQuestion({
      status: "locked",
      opensAt: new Date(now - 2 * 60 * 60_000),
      locksAt: new Date(now - 60_000),
    });
    const [row] = await db
      .insert(predictions)
      .values({ participantId, questionId: question.id, outcome: "yes" })
      .returning();

    const result = await reconcilePendingPredictions(db, adapter, new Date());
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const after = await predictionRow(row!.id);
    expect(after.chainStatus).toBe("failed");
    expect(after.lastError).toContain("locked");
  });

  it("repairs a chain-first crash: prediction on chain, row still pending", async () => {
    const adapter = createStubChainAdapter();
    const { participantId, wallet } = await participantWithWallet();
    const question = await insertOpenQuestion();

    // Simulate the crash: the chain submission succeeded...
    const { pda: questionPda } = await adapter.createQuestion({
      ruleHash: question.ruleHash,
      fixtureId: question.fixtureId,
      benchmarkFixtureId: null,
      statKey1: question.statKey1,
      statKey2: question.statKey2,
      operator: question.operator,
      comparison: question.comparison,
      threshold: question.threshold,
      benchmarkValue: null,
      opensAt: question.opensAt,
      locksAt: question.locksAt,
    });
    await db
      .update(questions)
      .set({ questionPda })
      .where(eq(questions.id, question.id));
    const submitted = await adapter.submitPrediction({
      questionPda,
      wallet,
      outcome: "no",
    });
    // ...but the process died before the row left pending.
    const [row] = await db
      .insert(predictions)
      .values({ participantId, questionId: question.id, outcome: "no" })
      .returning();

    const spy = vi.spyOn(adapter, "submitPrediction");
    const result = await reconcilePendingPredictions(db, adapter, new Date());
    expect(result.confirmed).toBeGreaterThanOrEqual(1);
    expect(spy).not.toHaveBeenCalled(); // repaired from the PDA, no second tx
    spy.mockRestore();

    const after = await predictionRow(row!.id);
    expect(after.chainStatus).toBe("confirmed");
    expect(after.predictionPda).toBe(submitted.pda);
    expect(after.signature).toBe(submitted.signature);
  });

  it("repairs a locked question's pending row when the chain already holds it", async () => {
    const adapter = createStubChainAdapter();
    const { participantId, wallet } = await participantWithWallet();
    const now = Date.now();
    // Open long enough to submit on-chain, then lock in the past for the tick.
    const question = await insertOpenQuestion();
    const { pda: questionPda } = await adapter.createQuestion({
      ruleHash: question.ruleHash,
      fixtureId: question.fixtureId,
      benchmarkFixtureId: null,
      statKey1: question.statKey1,
      statKey2: question.statKey2,
      operator: question.operator,
      comparison: question.comparison,
      threshold: question.threshold,
      benchmarkValue: null,
      opensAt: question.opensAt,
      locksAt: question.locksAt,
    });
    const submitted = await adapter.submitPrediction({
      questionPda,
      wallet,
      outcome: "yes",
    });
    await db
      .update(questions)
      .set({
        questionPda,
        status: "locked",
        locksAt: new Date(now - 1_000),
      })
      .where(eq(questions.id, question.id));
    const [row] = await db
      .insert(predictions)
      .values({ participantId, questionId: question.id, outcome: "yes" })
      .returning();

    await reconcilePendingPredictions(db, adapter, new Date());

    const after = await predictionRow(row!.id);
    expect(after.chainStatus).toBe("confirmed");
    expect(after.signature).toBe(submitted.signature);
  });

  it("keeps backing off (capped) while the chain keeps failing", async () => {
    const alwaysFailing = failingChain(Number.MAX_SAFE_INTEGER);
    const { participantId } = await participantWithWallet();
    const question = await insertOpenQuestion();
    const [row] = await db
      .insert(predictions)
      .values({ participantId, questionId: question.id, outcome: "yes" })
      .returning();

    const firstTick = new Date();
    await reconcilePendingPredictions(db, alwaysFailing, firstTick);
    const afterFirst = await predictionRow(row!.id);
    expect(afterFirst.chainStatus).toBe("pending");
    expect(afterFirst.attemptCount).toBe(1);
    expect(afterFirst.nextRetryAt!.getTime()).toBeGreaterThan(firstTick.getTime());

    const secondTick = new Date(afterFirst.nextRetryAt!.getTime() + 1);
    await reconcilePendingPredictions(db, alwaysFailing, secondTick);
    const afterSecond = await predictionRow(row!.id);
    expect(afterSecond.chainStatus).toBe("pending");
    expect(afterSecond.attemptCount).toBe(2);
    expect(afterSecond.nextRetryAt!.getTime() - secondTick.getTime()).toBe(60_000);
  });
});

describe("submitPendingPrediction", () => {
  it("is idempotent when racing itself: a prediction_exists error is repaired", async () => {
    const adapter = createStubChainAdapter();
    const { participantId, wallet } = await participantWithWallet();
    const question = await insertOpenQuestion();
    const [row] = await db
      .insert(predictions)
      .values({ participantId, questionId: question.id, outcome: "yes" })
      .returning();

    const [questionRow] = await db
      .select()
      .from(questions)
      .where(eq(questions.id, question.id));

    const first = await submitPendingPrediction(db, adapter, {
      prediction: row!,
      question: questionRow!,
      wallet,
    });
    expect(first).toBe("confirmed");

    // Force the row back to pending and submit again: the chain refuses a
    // second account, and the repair path confirms from the existing PDA.
    await db
      .update(predictions)
      .set({ chainStatus: "pending" })
      .where(eq(predictions.id, row!.id));
    const [pendingAgain] = await db
      .select()
      .from(predictions)
      .where(eq(predictions.id, row!.id));
    const [freshQuestion] = await db
      .select()
      .from(questions)
      .where(eq(questions.id, question.id));

    const second = await submitPendingPrediction(db, adapter, {
      prediction: pendingAgain!,
      question: freshQuestion!,
      wallet,
    });
    expect(second).toBe("confirmed");

    const after = await predictionRow(row!.id);
    expect(after.chainStatus).toBe("confirmed");
    expect(after.outcome).toBe("yes");
  });
});
