import { describe, expect, it, vi } from "vitest";
import { isChainError, type ChainAdapter } from "../chain";
import type { Database } from "../db/client";
import type { questions } from "../db/schema";
import {
  BASE_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  ensureQuestionOnChain,
  retryDelayMs,
} from "./reconciler";

type QuestionRow = typeof questions.$inferSelect;

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
