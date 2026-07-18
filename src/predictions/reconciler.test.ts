import { describe, expect, it, vi } from "vitest";
import { isChainError, type ChainAdapter, type ChainBatch } from "../chain";
import type { Database } from "../db/client";
import type { predictionBatches, questions } from "../db/schema";
import {
  BASE_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  ensureQuestionOnChain,
  retryDelayMs,
  submitPendingBatch,
} from "./reconciler";

type QuestionRow = typeof questions.$inferSelect;
type BatchRow = typeof predictionBatches.$inferSelect;

const OUR_AUTHORITY = "OurAuthorityPubkey11111111111111111111111111";
const PDA = "QuestionPda1111111111111111111111111111111111";

function questionRow(): QuestionRow {
  return { id: "q1", ruleHash: "ab".repeat(32), questionPda: null } as QuestionRow;
}

/** Minimal adapter exposing only what ensureQuestionOnChain touches. */
function fakeAdapter(overrides: Partial<ChainAdapter>): ChainAdapter {
  return {
    authorityPubkey: OUR_AUTHORITY,
    deriveQuestionPda: () => PDA,
    getQuestion: () => Promise.resolve(null),
    createQuestion: () => Promise.resolve({ pda: PDA }),
    ...overrides,
  } as ChainAdapter;
}

/** Records the questions row update ensureQuestionOnChain performs on success. */
function fakeDb() {
  const set = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }));
  const update = vi.fn(() => ({ set }));
  return { db: { update } as unknown as Database, update, set };
}

function questionOnChain(authority: string) {
  return {
    pda: PDA,
    authority,
    status: "open" as const,
    result: null,
  } as Awaited<ReturnType<ChainAdapter["getQuestion"]>>;
}

describe("retryDelayMs", () => {
  it("starts at the base delay", () => {
    expect(retryDelayMs(1)).toBe(BASE_RETRY_DELAY_MS);
  });

  it("doubles per attempt", () => {
    expect(retryDelayMs(2)).toBe(BASE_RETRY_DELAY_MS * 2);
    expect(retryDelayMs(3)).toBe(BASE_RETRY_DELAY_MS * 4);
    expect(retryDelayMs(4)).toBe(BASE_RETRY_DELAY_MS * 8);
  });

  it("caps at the maximum delay", () => {
    expect(retryDelayMs(6)).toBe(MAX_RETRY_DELAY_MS);
    expect(retryDelayMs(50)).toBe(MAX_RETRY_DELAY_MS);
  });

  it("tolerates a zero attempt count", () => {
    expect(retryDelayMs(0)).toBe(BASE_RETRY_DELAY_MS);
  });
});

describe("ensureQuestionOnChain authority guard", () => {
  it("throws a terminal authority_mismatch when a foreign account holds the PDA", async () => {
    const { db, update } = fakeDb();
    const adapter = fakeAdapter({
      getQuestion: () => Promise.resolve(questionOnChain("SquatterKey")),
    });

    const error = await ensureQuestionOnChain(db, adapter, questionRow()).catch(
      (e: unknown) => e,
    );
    expect(isChainError(error, "authority_mismatch")).toBe(true);
    // Never records a foreign PDA as ours.
    expect(update).not.toHaveBeenCalled();
  });

  it("re-checks authority after losing a create race", async () => {
    const { db } = fakeDb();
    const { ChainError } = await import("../chain");
    const adapter = fakeAdapter({
      // First read: absent. After the losing create, re-read finds a squatter.
      getQuestion: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(questionOnChain("SquatterKey")),
      createQuestion: () =>
        Promise.reject(new ChainError("question_exists", "in use")),
    });

    await expect(
      ensureQuestionOnChain(db, adapter, questionRow()),
    ).rejects.toMatchObject({ code: "authority_mismatch" });
  });

  it("records the PDA when the existing account is ours", async () => {
    const { db, update } = fakeDb();
    const adapter = fakeAdapter({
      getQuestion: () => Promise.resolve(questionOnChain(OUR_AUTHORITY)),
    });

    const pda = await ensureQuestionOnChain(db, adapter, questionRow());
    expect(pda).toBe(PDA);
    expect(update).toHaveBeenCalledTimes(1);
  });
});

const WALLET = "Wa11etPubkey1111111111111111111111111111111";
const BATCH_HASH = "ab".repeat(32);

function batchRow(overrides: Partial<BatchRow> = {}): BatchRow {
  return {
    id: "b1",
    fixtureId: "fixture-1",
    batchHash: BATCH_HASH,
    attemptCount: 0,
    chainStatus: "pending",
    ...overrides,
  } as BatchRow;
}

function chainBatch(overrides: Partial<ChainBatch> = {}): ChainBatch {
  return {
    pda: "BatchPda11111111111111111111111111111111111",
    wallet: WALLET,
    fixtureId: "fixture-1",
    batchHash: BATCH_HASH,
    signature: "Sig1111111111111111111111111111111111111111",
    submittedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

/** Adapter exposing the batch surface submitPendingBatch touches. */
function batchAdapter(overrides: Partial<ChainAdapter>): ChainAdapter {
  return {
    authorityPubkey: OUR_AUTHORITY,
    deriveBatchPda: (_wallet: string, fixtureId: string) => `pda:${fixtureId}`,
    getBatch: () => Promise.resolve(null),
    getLegacyBatch: () => Promise.resolve(null),
    submitBatch: () =>
      Promise.resolve({ pda: chainBatch().pda, signature: chainBatch().signature }),
    ...overrides,
  } as ChainAdapter;
}

describe("submitPendingBatch (per-fixture threading)", () => {
  it("threads the row's fixtureId into getBatch and submitBatch", async () => {
    const { db } = fakeDb();
    const getBatch = vi.fn(() => Promise.resolve(null));
    const submitBatch = vi.fn(() =>
      Promise.resolve({ pda: chainBatch().pda, signature: chainBatch().signature }),
    );
    const getLegacyBatch = vi.fn(() => Promise.resolve(null));
    const adapter = batchAdapter({ getBatch, submitBatch, getLegacyBatch });

    const outcome = await submitPendingBatch(db, adapter, {
      batch: batchRow({ fixtureId: "fixture-42" }),
      wallet: WALLET,
      now: new Date(),
    });

    expect(outcome).toBe("confirmed");
    expect(getBatch).toHaveBeenCalledWith(WALLET, "fixture-42");
    expect(submitBatch).toHaveBeenCalledWith({
      wallet: WALLET,
      fixtureId: "fixture-42",
      batchHash: BATCH_HASH,
    });
  });

  it("repairs a chain-first crash from the (wallet, fixture) PDA without resubmitting", async () => {
    const { db } = fakeDb();
    const submitBatch = vi.fn();
    const adapter = batchAdapter({
      getBatch: () => Promise.resolve(chainBatch()),
      submitBatch,
    });

    const outcome = await submitPendingBatch(db, adapter, {
      batch: batchRow(),
      wallet: WALLET,
    });

    expect(outcome).toBe("confirmed");
    expect(submitBatch).not.toHaveBeenCalled();
  });

  it("bridges a legacy v1 commitment only when its hash matches the row", async () => {
    const { db } = fakeDb();
    const submitBatch = vi.fn();
    const adapter = batchAdapter({
      getBatch: () => Promise.resolve(null),
      getLegacyBatch: () =>
        Promise.resolve(chainBatch({ fixtureId: null, batchHash: BATCH_HASH })),
      submitBatch,
    });

    const outcome = await submitPendingBatch(db, adapter, {
      batch: batchRow({ batchHash: BATCH_HASH }),
      wallet: WALLET,
    });

    expect(outcome).toBe("confirmed");
    // Bridged from v1: no new commitment written.
    expect(submitBatch).not.toHaveBeenCalled();
  });

  it("does NOT bridge a v1 commitment whose hash differs (submits v2 instead)", async () => {
    const { db } = fakeDb();
    const submitBatch = vi.fn(() =>
      Promise.resolve({ pda: chainBatch().pda, signature: chainBatch().signature }),
    );
    const adapter = batchAdapter({
      getBatch: () => Promise.resolve(null),
      // Legacy commitment belongs to a DIFFERENT fixture (different hash).
      getLegacyBatch: () =>
        Promise.resolve(chainBatch({ fixtureId: null, batchHash: "cd".repeat(32) })),
      submitBatch,
    });

    const outcome = await submitPendingBatch(db, adapter, {
      batch: batchRow({ fixtureId: "fixture-final", batchHash: BATCH_HASH }),
      wallet: WALLET,
    });

    expect(outcome).toBe("confirmed");
    // No misattribution: it submits its own v2 commitment for this fixture.
    expect(submitBatch).toHaveBeenCalledWith({
      wallet: WALLET,
      fixtureId: "fixture-final",
      batchHash: BATCH_HASH,
    });
  });
});
