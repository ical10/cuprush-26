import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import {
  createStubChainAdapter,
  type ChainAdapter,
  type ChainBatch,
} from "../chain";
import { reconcilePendingBatches } from "./reconciler";
import { computeBatchHash } from "./hash";
import { createApp } from "../api/app";
import { createDevAuthAdapter } from "../api/auth/dev";

/**
 * Issue #32 proof: prediction batches are keyed per (participant, fixture),
 * every batch's hash freezes on chain when its fixture locks, and the two
 * fixtures a participant answers commit independently. This file drives the
 * real merged pieces end to end against a local Postgres and the stub chain
 * adapter — the request routes (human batch + agent cohort), the reconciler's
 * lock-gated commit, and the schema's per-fixture invariant — rather than
 * reaching past them. The single load-bearing assertion (scenario 5) is that
 * no accepted pick exists outside a confirmed batch hash.
 */

const {
  agentCohorts,
  agents,
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

// Integration files run serially (vitest.config fileParallelism:false) and
// share one DB, so a start-of-file truncate is safe and isolates the global
// reconciler scan to this file's rows.
async function truncateAll() {
  await sql`TRUNCATE agent_decisions, agents, agent_cohorts, predictions, prediction_batches, users, questions, fixtures, participants RESTART IDENTITY CASCADE`;
}

beforeAll(async () => {
  await truncateAll();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  app = createApp({ db, auth: createDevAuthAdapter({}) });
  warn.mockRestore();
});

afterAll(async () => {
  await truncateAll();
  await sql.end();
});

// --- shared helpers ---------------------------------------------------------

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

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

/** A human participant with an embedded wallet, provisioned via the real route. */
async function humanWithWallet() {
  const token = devToken();
  const address = base58Address();
  const res = await app.request(
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

/** A bare fixture row with a kickoff `startsInMs` from now. */
async function insertFixture(startsInMs: number): Promise<string> {
  const id = `fx-${randomUUID().slice(0, 18)}`;
  await db.insert(fixtures).values({
    id,
    homeTeam: "Argentina",
    awayTeam: "France",
    startsAt: new Date(Date.now() + startsInMs),
  });
  return id;
}

/**
 * An open winner question on `fixtureId`, locking at kickoff-30m (mirrors
 * src/questions/generate.ts, so the reconciler's starts_at gate and the route
 * lock checks agree).
 */
async function insertOpenWinner(fixtureId: string, startsInMs: number) {
  const [q] = await db
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
      opensAt: new Date(Date.now() - 60 * 60_000),
      locksAt: new Date(Date.now() + startsInMs - 30 * 60_000),
      ruleHash: randomBytes(32).toString("hex"),
    })
    .returning();
  return q!;
}

function postBatch(token: string, answers: unknown) {
  return app.request(
    "/api/predictions/batch",
    authed(token, { method: "POST", body: JSON.stringify({ answers }) }),
  );
}

async function batchFor(participantId: string, fixtureId: string) {
  const [row] = await db
    .select()
    .from(predictionBatches)
    .where(
      and(
        eq(predictionBatches.participantId, participantId),
        eq(predictionBatches.fixtureId, fixtureId),
      ),
    );
  return row!;
}

/** The stored (questionId, outcome) picks of a batch, for hash recomputation. */
async function picksOf(batchId: string) {
  return db
    .select({ questionId: predictions.questionId, outcome: predictions.outcome })
    .from(predictions)
    .where(eq(predictions.batchId, batchId));
}

// --- cohort (agent) helpers -------------------------------------------------

/** A one-agent active cohort with a known bearer token and a funded wallet. */
async function createCohortWithAgent() {
  const [owner] = await db
    .insert(participants)
    .values({ kind: "human", displayName: "Owner" })
    .returning();
  const [ownerUser] = await db
    .insert(users)
    .values({ participantId: owner!.id, privyUserId: `did:privy:${randomUUID()}` })
    .returning();

  const token = `tok-${randomUUID()}`;
  const [cohort] = await db
    .insert(agentCohorts)
    .values({
      ownerUserId: ownerUser!.id,
      name: `c-${randomUUID().slice(0, 8)}`,
      tokenHash: sha256Hex(token),
      status: "active",
    })
    .returning();

  const wallet = base58Address();
  const [agentParticipant] = await db
    .insert(participants)
    .values({ kind: "agent", walletAddress: wallet, displayName: "Agent" })
    .returning();
  const agentKey = `ak-${randomUUID().slice(0, 8)}`;
  await db.insert(agents).values({
    participantId: agentParticipant!.id,
    cohortId: cohort!.id,
    agentKey,
    persona: "persona",
    strategy: "strategy",
    model: "model",
    status: "active",
  });

  return { token, agentKey, participantId: agentParticipant!.id, wallet };
}

function submitDecisions(token: string, decisions: unknown) {
  return app.request("/api/cohort/decisions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(decisions),
  });
}

type DecisionResult = { results: { ok: boolean; error?: string }[] };

describe("per-fixture batch commitments (issue #32)", () => {
  it("scenario 1 — two fixtures commit independently, each hash verifying against its own picks", async () => {
    const { token, wallet, participantId } = await humanWithWallet();

    // Fixture A locks soon (kickoff 60m out); the participant answers its deck.
    const fixtureA = await insertFixture(60 * 60_000);
    const a1 = await insertOpenWinner(fixtureA, 60 * 60_000);
    const a2 = await insertOpenWinner(fixtureA, 60 * 60_000);
    const aAnswers = [
      { questionId: a1.id, outcome: "yes" },
      { questionId: a2.id, outcome: "no" },
    ];
    expect((await postBatch(token, aAnswers)).status).toBe(201);

    // A locks (kickoff-30m) -> the reconciler freezes batch A on chain.
    await reconcilePendingBatches(db, chain, new Date(Date.now() + 31 * 60_000));
    const batchA = await batchFor(participantId, fixtureA);
    expect(batchA.chainStatus).toBe("confirmed");

    const hashA = computeBatchHash(await picksOf(batchA.id));
    const onChainA = await chain.getBatch(wallet, fixtureA);
    expect(onChainA?.batchHash).toBe(hashA);
    expect(batchA.batchHash).toBe(hashA);

    // Fixture B opens later (kickoff 4h out); same participant answers its deck.
    const fixtureB = await insertFixture(4 * 60 * 60_000);
    const b1 = await insertOpenWinner(fixtureB, 4 * 60 * 60_000);
    expect((await postBatch(token, [{ questionId: b1.id, outcome: "yes" }])).status).toBe(
      201,
    );

    // B locks -> its own batch commits; A is already confirmed and untouched.
    await reconcilePendingBatches(
      db,
      chain,
      new Date(Date.now() + 4 * 60 * 60_000 - 29 * 60_000),
    );
    const batchB = await batchFor(participantId, fixtureB);
    expect(batchB.chainStatus).toBe("confirmed");

    const hashB = computeBatchHash(await picksOf(batchB.id));
    const onChainB = await chain.getBatch(wallet, fixtureB);
    expect(onChainB?.batchHash).toBe(hashB);
    expect(batchB.batchHash).toBe(hashB);

    // Two distinct batch rows, distinct PDAs, both confirmed.
    expect(batchA.id).not.toBe(batchB.id);
    expect(batchA.batchPda).not.toBeNull();
    expect(batchB.batchPda).not.toBeNull();
    expect(batchA.batchPda).not.toBe(batchB.batchPda);

    // Each hash verifies against its own fixture's picks only — never the other.
    expect(hashA).not.toBe(hashB);
    expect(onChainA?.batchHash).not.toBe(hashB);
    expect(onChainB?.batchHash).not.toBe(hashA);

    // B's activity never mutated A's frozen commitment.
    const batchAafter = await batchFor(participantId, fixtureA);
    expect(batchAafter.batchHash).toBe(hashA);
    expect((await chain.getBatch(wallet, fixtureA))?.batchHash).toBe(hashA);
  });

  it("scenario 2 — a pick added before lock lands in the frozen hash; pre-lock never submits", async () => {
    const { token, agentKey, participantId, wallet } = await createCohortWithAgent();

    // One fixture, two questions; kickoff 60m out -> locks 30m out.
    const fixtureC = await insertFixture(60 * 60_000);
    const q1 = await insertOpenWinner(fixtureC, 60 * 60_000);
    const q2 = await insertOpenWinner(fixtureC, 60 * 60_000);

    // Tick 1: first pick creates the pending batch (hash over {q1}).
    const first: DecisionResult = await (
      await submitDecisions(token, [
        { agent_key: agentKey, question_id: q1.id, outcome: "yes", confidence: 0.5, rationale: "r1" },
      ])
    ).json();
    expect(first.results[0]!.ok).toBe(true);
    const afterTick1 = await batchFor(participantId, fixtureC);
    expect(afterTick1.chainStatus).toBe("pending");
    const hashTick1 = afterTick1.batchHash;

    // A pre-lock reconcile pass must NOT submit this fixture's batch.
    const spy = vi.spyOn(chain, "submitBatch");
    await reconcilePendingBatches(db, chain, new Date());
    const preLockCalls = spy.mock.calls.filter((c) => c[0].fixtureId === fixtureC);
    expect(preLockCalls).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
    expect((await batchFor(participantId, fixtureC)).chainStatus).toBe("pending");
    spy.mockRestore();

    // Tick 2, still inside the pre-lock window: a second pick extends the batch.
    const second: DecisionResult = await (
      await submitDecisions(token, [
        { agent_key: agentKey, question_id: q2.id, outcome: "no", confidence: 0.6, rationale: "r2" },
      ])
    ).json();
    expect(second.results[0]!.ok).toBe(true);
    const afterTick2 = await batchFor(participantId, fixtureC);
    expect(afterTick2.batchHash).not.toBe(hashTick1); // the late pick changed the hash

    // Lock -> commit. The confirmed hash includes BOTH picks.
    await reconcilePendingBatches(db, chain, new Date(Date.now() + 31 * 60_000));
    const committed = await batchFor(participantId, fixtureC);
    expect(committed.chainStatus).toBe("confirmed");

    const expected = computeBatchHash(await picksOf(committed.id));
    expect(committed.batchHash).toBe(expected);
    expect((await chain.getBatch(wallet, fixtureC))?.batchHash).toBe(expected);
    // The frozen hash is the two-pick hash, not the tick-1 single-pick hash.
    expect(committed.batchHash).not.toBe(hashTick1);
    expect((await picksOf(committed.id))).toHaveLength(2);
  });

  it("scenario 3 — a legacy v1 commitment bridges only when its hash matches the row", async () => {
    const { participantId, wallet } = await humanWithWallet();

    // Two locked fixtures (kickoff in the past -> the reconciler's gate is open),
    // each with a directly-inserted pending batch, mirroring a chain-first crash.
    const legacyFixture = await insertFixture(-60 * 60_000);
    const otherFixture = await insertFixture(-60 * 60_000);
    const legacyHash = "a".repeat(64);
    const otherHash = "b".repeat(64);
    await db.insert(predictionBatches).values([
      { participantId, fixtureId: legacyFixture, batchHash: legacyHash },
      { participantId, fixtureId: otherFixture, batchHash: otherHash },
    ]);

    // A v1 commitment for this wallet carries no fixtureId; it can only be
    // attributed by hash equality (the content proof).
    const legacyPda = base58Address();
    const legacySig = base58Address() + base58Address(); // 86 chars, <= 88
    const adapter: ChainAdapter = {
      ...createStubChainAdapter(),
      getLegacyBatch(w: string): Promise<ChainBatch | null> {
        if (w !== wallet) return Promise.resolve(null);
        return Promise.resolve({
          pda: legacyPda,
          wallet,
          fixtureId: null,
          batchHash: legacyHash,
          signature: legacySig,
          submittedAt: new Date(),
        });
      },
    };
    const submitSpy = vi.spyOn(adapter, "submitBatch");

    await reconcilePendingBatches(db, adapter, new Date());

    // The matching-hash row bridged from the v1 memo: confirmed, no new tx,
    // and it carries the legacy PDA/signature.
    const bridged = await batchFor(participantId, legacyFixture);
    expect(bridged.chainStatus).toBe("confirmed");
    expect(bridged.batchPda).toBe(legacyPda);
    expect(bridged.signature).toBe(legacySig);

    // The non-matching row did NOT misattribute the v1 memo — it submitted its
    // own v2 commitment for its fixture.
    const other = await batchFor(participantId, otherFixture);
    expect(other.chainStatus).toBe("confirmed");
    expect(other.batchPda).not.toBe(legacyPda);
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(submitSpy).toHaveBeenCalledWith({
      wallet,
      fixtureId: otherFixture,
      batchHash: otherHash,
    });
    submitSpy.mockRestore();
  });

  it("scenario 5 — an agent's picks across two ticks/two fixtures are wholly on-chain: no pick outside a confirmed hash", async () => {
    const { token, agentKey, participantId, wallet } = await createCohortWithAgent();

    // Tick 1: fixture A opens, the agent answers it, A locks, batch A confirms.
    const fixtureA = await insertFixture(60 * 60_000);
    const qA = await insertOpenWinner(fixtureA, 60 * 60_000);
    const t1: DecisionResult = await (
      await submitDecisions(token, [
        { agent_key: agentKey, question_id: qA.id, outcome: "yes", confidence: 0.5, rationale: "a" },
      ])
    ).json();
    expect(t1.results[0]!.ok).toBe(true);
    await reconcilePendingBatches(db, chain, new Date(Date.now() + 31 * 60_000));
    expect((await batchFor(participantId, fixtureA)).chainStatus).toBe("confirmed");

    // Tick 2 (after A confirmed): fixture B opens, the agent answers it, B locks.
    const fixtureB = await insertFixture(3 * 60 * 60_000);
    const qB = await insertOpenWinner(fixtureB, 3 * 60 * 60_000);
    const t2: DecisionResult = await (
      await submitDecisions(token, [
        { agent_key: agentKey, question_id: qB.id, outcome: "no", confidence: 0.5, rationale: "b" },
      ])
    ).json();
    expect(t2.results[0]!.ok).toBe(true);
    await reconcilePendingBatches(
      db,
      chain,
      new Date(Date.now() + 3 * 60 * 60_000 - 29 * 60_000),
    );

    // Both fixtures' batches confirm, both hashes verify against their picks.
    const batchA = await batchFor(participantId, fixtureA);
    const batchB = await batchFor(participantId, fixtureB);
    for (const [batch, fixtureId] of [
      [batchA, fixtureA],
      [batchB, fixtureB],
    ] as const) {
      expect(batch.chainStatus).toBe("confirmed");
      const hash = computeBatchHash(await picksOf(batch.id));
      expect(batch.batchHash).toBe(hash);
      expect((await chain.getBatch(wallet, fixtureId))?.batchHash).toBe(hash);
    }

    // The load-bearing invariant that closes issue #32 for this participant:
    // NO accepted pick exists outside a confirmed batch hash. Every prediction
    // belongs to a confirmed batch, and every confirmed batch's on-chain hash
    // is exactly the hash of the picks it carries.
    const owned = await db
      .select({ pred: predictions, batch: predictionBatches })
      .from(predictions)
      .innerJoin(predictionBatches, eq(predictions.batchId, predictionBatches.id))
      .where(eq(predictions.participantId, participantId));

    expect(owned.map((r) => r.pred.questionId).sort()).toEqual([qA.id, qB.id].sort());
    const uncommitted = owned.filter((r) => r.batch.chainStatus !== "confirmed");
    expect(uncommitted).toHaveLength(0);

    const batchIds = [...new Set(owned.map((r) => r.batch.id))];
    for (const batchId of batchIds) {
      const [row] = await db
        .select()
        .from(predictionBatches)
        .where(eq(predictionBatches.id, batchId));
      const onChain = await chain.getBatch(wallet, row!.fixtureId);
      const recomputed = computeBatchHash(await picksOf(batchId));
      expect(onChain?.batchHash).toBe(recomputed);
      expect(row!.batchHash).toBe(recomputed);
    }
  });

  it("scenario 6 — a submission for a locked question is rejected (full-deck-race negative)", async () => {
    const { token, participantId } = await humanWithWallet();
    // Kickoff 29m out -> the 30m lock cutoff has already passed.
    const fixtureLocked = await insertFixture(29 * 60_000);
    const q = await insertOpenWinner(fixtureLocked, 29 * 60_000);

    const res = await postBatch(token, [{ questionId: q.id, outcome: "yes" }]);
    expect(res.status).toBe(409);

    // All-or-nothing: nothing was written for the locked deck.
    expect(await batchFor(participantId, fixtureLocked)).toBeUndefined();
    const rows = await db
      .select()
      .from(predictions)
      .where(eq(predictions.participantId, participantId));
    expect(rows).toHaveLength(0);
  });

  it("scenario 4 — migration invariant: every batch has a fixture matching its predictions' questions", async () => {
    // A data-invariant sweep over everything the flows above created.
    const allBatches = await db.select().from(predictionBatches);
    expect(allBatches.length).toBeGreaterThan(0);
    expect(allBatches.every((b) => b.fixtureId !== null)).toBe(true);

    // No prediction may sit in a batch whose fixture differs from the fixture
    // its question belongs to — the per-fixture backfill invariant.
    const violations = await db
      .select({
        batchFixture: predictionBatches.fixtureId,
        questionFixture: questions.fixtureId,
      })
      .from(predictionBatches)
      .innerJoin(predictions, eq(predictions.batchId, predictionBatches.id))
      .innerJoin(questions, eq(predictions.questionId, questions.id))
      .where(ne(questions.fixtureId, predictionBatches.fixtureId));
    expect(violations).toHaveLength(0);
  });
});
