import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { ChainError, createStubChainAdapter, type ChainAdapter } from "../chain";
import { reconcilePendingBatches, submitPendingBatch } from "../predictions/reconciler";
import { computeBatchHash } from "../predictions/hash";
import { createApp } from "./app";
import { createDevAuthAdapter } from "./auth/dev";

const { fixtures, predictionBatches, predictions, questions, users } = schema;
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
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 43; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

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

/** Inserts a fixture (kickoff `startsInMs` from now) + one open winner question. */
async function insertOpenQuestion(
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

/**
 * A bare fixture row — a batch needs one for its NOT NULL fixture_id FK. Its
 * kickoff is in the past, so the fixture has already locked: the reconciler's
 * lock gate lets these directly-inserted batches through, keeping these tests
 * focused on submit/retry/repair mechanics rather than lock timing.
 */
async function newFixture() {
  const fixtureId = `fx-${randomUUID().slice(0, 18)}`;
  await db.insert(fixtures).values({
    id: fixtureId,
    homeTeam: "Argentina",
    awayTeam: "France",
    startsAt: new Date(Date.now() - 60 * 60_000),
  });
  return fixtureId;
}

type BatchBody = {
  id: string;
  batchHash: string;
  chainStatus: string;
  signature: string | null;
  predictions: { questionId: string; outcome: string }[];
};

function postBatch(token: string, answers: unknown, appInstance = app) {
  return appInstance.request(
    "/api/predictions/batch",
    authed(token, { method: "POST", body: JSON.stringify({ answers }) }),
  );
}

async function batchRow(participantId: string) {
  const [row] = await db
    .select()
    .from(predictionBatches)
    .where(eq(predictionBatches.participantId, participantId));
  return row!;
}

/** A stub whose submitBatch fails `failures` times, then delegates. */
function failingChain(failures: number): ChainAdapter {
  const inner = createStubChainAdapter();
  let remaining = failures;
  return {
    ...inner,
    submitBatch(input) {
      if (remaining > 0) {
        remaining -= 1;
        return Promise.reject(new ChainError("not_configured", "rpc unavailable"));
      }
      return inner.submitBatch(input);
    },
  };
}

describe("POST /api/predictions/batch", () => {
  it("happy path: one fixture's picks become a single batch, committed at lock", async () => {
    const { token, wallet } = await participantWithWallet();
    const q1 = await insertOpenQuestion();
    // Second question on the SAME fixture -> one batch.
    const q2 = await insertOpenQuestion({ fixtureId: q1.fixtureId });
    const answers = [
      { questionId: q1.id, outcome: "yes" },
      { questionId: q2.id, outcome: "no" },
    ];

    const res = await postBatch(token, answers);
    expect(res.status).toBe(201);

    const body: BatchBody[] = await res.json();
    expect(body).toHaveLength(1);
    const batch = body[0]!;

    // The request path stores the batch pending with an always-current hash;
    // it never submits on chain.
    expect(batch.chainStatus).toBe("pending");
    expect(batch.signature).toBeNull();
    expect(batch.predictions).toHaveLength(2);
    // Server computed the hash canonically from the inserted answers.
    expect(batch.batchHash).toBe(computeBatchHash(answers));

    const rows = await db
      .select()
      .from(predictions)
      .where(eq(predictions.batchId, batch.id));
    expect(rows).toHaveLength(2);

    // The reconciler is the single commit path: once the fixture locks
    // (kickoff-30m) it freezes the hash on chain at the (wallet, fixture) PDA.
    await reconcilePendingBatches(db, chain, new Date(Date.now() + 61 * 60_000));
    const [committed] = await db
      .select()
      .from(predictionBatches)
      .where(eq(predictionBatches.id, batch.id));
    expect(committed!.chainStatus).toBe("confirmed");
    expect(committed!.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
    const onChain = await chain.getBatch(wallet, q1.fixtureId);
    expect(onChain?.batchHash).toBe(batch.batchHash);
  });

  it("splits a two-fixture deck into one batch per fixture, hashed separately", async () => {
    const { token, participantId } = await participantWithWallet();
    const q1 = await insertOpenQuestion();
    const q2 = await insertOpenQuestion(); // different fixture

    const res = await postBatch(token, [
      { questionId: q1.id, outcome: "yes" },
      { questionId: q2.id, outcome: "no" },
    ]);
    expect(res.status).toBe(201);

    const body: BatchBody[] = await res.json();
    expect(body).toHaveLength(2);
    // Each batch carries exactly its fixture's single answer, hashed on its own.
    for (const b of body) expect(b.predictions).toHaveLength(1);
    expect(new Set(body.map((b) => b.batchHash)).size).toBe(2);

    // Two batch rows, one per distinct fixture.
    const batchRows = await db
      .select()
      .from(predictionBatches)
      .where(eq(predictionBatches.participantId, participantId));
    expect(batchRows).toHaveLength(2);
    expect(new Set(batchRows.map((r) => r.fixtureId))).toEqual(
      new Set([q1.fixtureId, q2.fixtureId]),
    );
  });

  it("resubmit for a fixture returns its existing batch, never a second batch or chain call", async () => {
    const { token } = await participantWithWallet();
    const q1 = await insertOpenQuestion();
    // Same fixture as q1 -> a resubmit targets the same batch.
    const q2 = await insertOpenQuestion({ fixtureId: q1.fixtureId });
    const spy = vi.spyOn(chain, "submitBatch");

    const first = await postBatch(token, [{ questionId: q1.id, outcome: "yes" }]);
    expect(first.status).toBe(201);
    const firstBody: BatchBody[] = await first.json();
    const callsAfterFirst = spy.mock.calls.length;

    // A different answer set on resubmit is ignored — one immutable batch.
    const second = await postBatch(token, [{ questionId: q2.id, outcome: "no" }]);
    expect(second.status).toBe(200);
    const secondBody: BatchBody[] = await second.json();

    expect(secondBody[0]!.id).toBe(firstBody[0]!.id);
    expect(secondBody[0]!.predictions).toEqual([
      { questionId: q1.id, outcome: "yes" },
    ]);
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
    spy.mockRestore();
  });

  it("accepts a batch whose earliest kickoff is just beyond the lock margin", async () => {
    const { token } = await participantWithWallet();
    // Kickoff 31 min out -> cutoff (kickoff-30m) is 1 min in the future.
    const q = await insertOpenQuestion({}, 31 * 60_000);
    const res = await postBatch(token, [{ questionId: q.id, outcome: "yes" }]);
    expect(res.status).toBe(201);
  });

  it("rejects the whole batch when any answer is past the lock cutoff", async () => {
    const { token, participantId } = await participantWithWallet();
    const early = await insertOpenQuestion({}, 90 * 60_000); // fine on its own
    // Kickoff 29 min out -> cutoff already passed -> locks the whole batch.
    const late = await insertOpenQuestion({}, 29 * 60_000);

    const res = await postBatch(token, [
      { questionId: early.id, outcome: "yes" },
      { questionId: late.id, outcome: "no" },
    ]);
    expect(res.status).toBe(409);

    // All-or-nothing: nothing was inserted.
    const rows = await db
      .select()
      .from(predictions)
      .where(eq(predictions.participantId, participantId));
    expect(rows).toHaveLength(0);
    const [batch] = await db
      .select()
      .from(predictionBatches)
      .where(eq(predictionBatches.participantId, participantId));
    expect(batch).toBeUndefined();
  });

  it("rejects an outcome that does not fit a question type with 422", async () => {
    const { token } = await participantWithWallet();
    const q = await insertOpenQuestion(); // winner: yes/no
    const res = await postBatch(token, [{ questionId: q.id, outcome: "higher" }]);
    expect(res.status).toBe(422);
  });

  it("returns 404 when a referenced question does not exist", async () => {
    const { token } = await participantWithWallet();
    const q = await insertOpenQuestion();
    const res = await postBatch(token, [
      { questionId: q.id, outcome: "yes" },
      { questionId: randomUUID(), outcome: "yes" },
    ]);
    expect(res.status).toBe(404);
  });

  it("rejects a participant without a wallet with 400", async () => {
    const token = devToken();
    await app.request("/api/me", authed(token)); // provision, no wallet
    const q = await insertOpenQuestion();
    const res = await postBatch(token, [{ questionId: q.id, outcome: "yes" }]);
    expect(res.status).toBe(400);
  });

  it("rejects a participant who revoked delegation with 403", async () => {
    const { token } = await participantWithWallet();
    await app.request(
      "/api/wallet/delegation/revoke",
      authed(token, { method: "POST" }),
    );
    const q = await insertOpenQuestion();
    const res = await postBatch(token, [{ questionId: q.id, outcome: "yes" }]);
    expect(res.status).toBe(403);
  });

  it("rejects invalid bodies with 400", async () => {
    const { token } = await participantWithWallet();
    const q = await insertOpenQuestion();
    const bodies = [
      [], // empty
      [{ questionId: "not-a-uuid", outcome: "yes" }],
      [{ questionId: randomUUID(), outcome: "maybe" }],
      [{ questionId: q.id, outcome: "yes", extra: 1 }],
      [
        { questionId: q.id, outcome: "yes" },
        { questionId: q.id, outcome: "no" }, // duplicate questionId
      ],
    ];
    for (const answers of bodies) {
      const res = await postBatch(token, answers);
      expect(res.status).toBe(400);
    }
  });

  it("requires authentication", async () => {
    const res = await app.request("/api/predictions/batch", {
      method: "POST",
      body: JSON.stringify({ answers: [{ questionId: randomUUID(), outcome: "yes" }] }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  it("caps submissions per participant per minute with 429", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limitedApp = createApp({
      db,
      auth: createDevAuthAdapter({}),
      predictions: { rateLimit: { limit: 1, windowMs: 60_000 } },
    });
    warn.mockRestore();

    const { token } = await participantWithWallet(limitedApp);
    const q = await insertOpenQuestion();

    const first = await postBatch(token, [{ questionId: q.id, outcome: "yes" }], limitedApp);
    expect(first.status).toBe(201);
    // Second call (a resubmit) is rate-limited before it even reads the batch.
    const second = await postBatch(token, [{ questionId: q.id, outcome: "yes" }], limitedApp);
    expect(second.status).toBe(429);
  });

  it("holds a pending batch until its fixture locks, then the reconciler commits it", async () => {
    const { token, participantId, wallet } = await participantWithWallet();
    const q = await insertOpenQuestion(); // kickoff 90m out -> locks 60m out
    const res = await postBatch(token, [{ questionId: q.id, outcome: "yes" }]);
    expect(res.status).toBe(201);

    // Request path never touches chain: pending, no attempt, no signature.
    const afterPost = await batchRow(participantId);
    expect(afterPost.chainStatus).toBe("pending");
    expect(afterPost.attemptCount).toBe(0);
    expect(afterPost.signature).toBeNull();

    // Before lock (kickoff-30m): the reconciler must not submit this batch.
    const spy = vi.spyOn(chain, "submitBatch");
    await reconcilePendingBatches(db, chain, new Date());
    expect(spy).not.toHaveBeenCalled();
    expect((await batchRow(participantId)).chainStatus).toBe("pending");

    // At/after lock: the reconciler commits the now-frozen hash on chain.
    await reconcilePendingBatches(db, chain, new Date(Date.now() + 61 * 60_000));
    spy.mockRestore();
    const committed = await batchRow(participantId);
    expect(committed.chainStatus).toBe("confirmed");
    const onChain = await chain.getBatch(wallet, q.fixtureId);
    expect(onChain?.batchHash).toBe(committed.batchHash);
  });
});

describe("GET /api/predictions", () => {
  it("lists only the caller's predictions with chain status from the batch", async () => {
    const mine = await participantWithWallet();
    const theirs = await participantWithWallet();
    const question = await insertOpenQuestion();

    await postBatch(mine.token, [{ questionId: question.id, outcome: "yes" }]);
    await postBatch(theirs.token, [{ questionId: question.id, outcome: "no" }]);

    // Commit both batches on chain (the fixture has locked) so GET reflects
    // the confirmed status it reads off the parent batch.
    await reconcilePendingBatches(db, chain, new Date(Date.now() + 61 * 60_000));

    // Settle the question on chain so GET can expose the settlement tx.
    const settlementSignature = randomBytes(44).toString("hex").slice(0, 88);
    await db
      .update(questions)
      .set({ status: "settled", result: "yes", settlementSignature })
      .where(eq(questions.id, question.id));

    const res = await app.request("/api/predictions", authed(mine.token));
    expect(res.status).toBe(200);
    const rows: {
      questionId: string;
      outcome: string;
      chainStatus: string;
      question: {
        id: string;
        template: string;
        fixtureId: string;
        settlementSignature: string | null;
      };
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
      settlementSignature,
    });
  });

  it("requires authentication", async () => {
    const res = await app.request("/api/predictions");
    expect(res.status).toBe(401);
  });
});

describe("batch reconciler", () => {
  it("commits a pending batch on retry after a transient chain failure at lock", async () => {
    const flaky = failingChain(1);
    const { token, participantId } = await participantWithWallet();
    const q = await insertOpenQuestion();
    await postBatch(token, [{ questionId: q.id, outcome: "yes" }]);
    expect((await batchRow(participantId)).chainStatus).toBe("pending");

    // The first commit attempt fires once the fixture locks, but the chain
    // fails transiently: the batch stays pending with a scheduled backoff.
    const lockTime = new Date(Date.now() + 61 * 60_000);
    await reconcilePendingBatches(db, flaky, lockTime);
    const afterFail = await batchRow(participantId);
    expect(afterFail.chainStatus).toBe("pending");
    expect(afterFail.attemptCount).toBe(1);
    expect(afterFail.nextRetryAt).not.toBeNull();
    expect(afterFail.lastError).toContain("rpc unavailable");

    // Due one backoff step later: the retry succeeds (lock no longer gates it).
    await reconcilePendingBatches(db, flaky, new Date(afterFail.nextRetryAt!.getTime() + 1));
    const row = await batchRow(participantId);
    expect(row.chainStatus).toBe("confirmed");
    expect(row.batchPda).not.toBeNull();
    expect(row.signature).not.toBeNull();
    expect(row.nextRetryAt).toBeNull();
    expect(row.lastError).toBeNull();
  });

  it("repairs a chain-first crash: batch on chain, row still pending", async () => {
    const adapter = createStubChainAdapter();
    const { participantId, wallet } = await participantWithWallet();

    // Chain submit succeeded...
    const fixtureId = await newFixture();
    const submitted = await adapter.submitBatch({
      wallet,
      fixtureId,
      batchHash: "a".repeat(64),
    });
    // ...but the process died before the row left pending.
    const [row] = await db
      .insert(predictionBatches)
      .values({ participantId, fixtureId, batchHash: "a".repeat(64) })
      .returning();

    const spy = vi.spyOn(adapter, "submitBatch");
    const result = await reconcilePendingBatches(db, adapter, new Date());
    expect(result.confirmed).toBeGreaterThanOrEqual(1);
    expect(spy).not.toHaveBeenCalled(); // repaired from the PDA, no second tx
    spy.mockRestore();

    const [after] = await db
      .select()
      .from(predictionBatches)
      .where(eq(predictionBatches.id, row!.id));
    expect(after!.chainStatus).toBe("confirmed");
    expect(after!.batchPda).toBe(submitted.pda);
    expect(after!.signature).toBe(submitted.signature);
  });

  it("keeps backing off (capped) while the chain keeps failing", async () => {
    const alwaysFailing = failingChain(Number.MAX_SAFE_INTEGER);
    const { participantId } = await participantWithWallet();
    const [row] = await db
      .insert(predictionBatches)
      .values({ participantId, fixtureId: await newFixture(), batchHash: "b".repeat(64) })
      .returning();

    const firstTick = new Date();
    await reconcilePendingBatches(db, alwaysFailing, firstTick);
    const [afterFirst] = await db
      .select()
      .from(predictionBatches)
      .where(eq(predictionBatches.id, row!.id));
    expect(afterFirst!.chainStatus).toBe("pending");
    expect(afterFirst!.attemptCount).toBe(1);

    const secondTick = new Date(afterFirst!.nextRetryAt!.getTime() + 1);
    await reconcilePendingBatches(db, alwaysFailing, secondTick);
    const [afterSecond] = await db
      .select()
      .from(predictionBatches)
      .where(eq(predictionBatches.id, row!.id));
    expect(afterSecond!.attemptCount).toBe(2);
    expect(afterSecond!.nextRetryAt!.getTime() - secondTick.getTime()).toBe(60_000);
  });
});

describe("submitPendingBatch", () => {
  it("is idempotent when racing itself: a batch_exists error is repaired", async () => {
    const adapter = createStubChainAdapter();
    const { participantId, wallet } = await participantWithWallet();
    const [row] = await db
      .insert(predictionBatches)
      .values({ participantId, fixtureId: await newFixture(), batchHash: "c".repeat(64) })
      .returning();

    const first = await submitPendingBatch(db, adapter, { batch: row!, wallet });
    expect(first).toBe("confirmed");

    // Force back to pending and submit again: the chain refuses a second
    // account, and the repair path confirms from the existing PDA.
    await db
      .update(predictionBatches)
      .set({ chainStatus: "pending" })
      .where(eq(predictionBatches.id, row!.id));
    const [pendingAgain] = await db
      .select()
      .from(predictionBatches)
      .where(eq(predictionBatches.id, row!.id));

    const second = await submitPendingBatch(db, adapter, {
      batch: pendingAgain!,
      wallet,
    });
    expect(second).toBe("confirmed");

    const [after] = await db
      .select()
      .from(predictionBatches)
      .where(eq(predictionBatches.id, row!.id));
    expect(after!.chainStatus).toBe("confirmed");
  });
});
