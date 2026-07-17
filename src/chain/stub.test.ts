import { describe, expect, it } from "vitest";
import { ChainError, type ChainQuestionRule } from "./adapter";
import { createStubChainAdapter } from "./stub";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

const now = new Date("2026-07-01T12:00:00Z");
const clock = () => now;

function rule(overrides: Partial<ChainQuestionRule> = {}): ChainQuestionRule {
  return {
    ruleHash: "a".repeat(64),
    fixtureId: "fixture-1",
    benchmarkFixtureId: null,
    statKey1: "home.full_time.goals",
    statKey2: "away.full_time.goals",
    operator: "subtract",
    comparison: "greater_than",
    threshold: 0,
    benchmarkValue: null,
    opensAt: new Date(now.getTime() - 60_000),
    locksAt: new Date(now.getTime() + 60_000),
    ...overrides,
  };
}

const WALLET = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

describe("stub PDA derivation", () => {
  it("derives the same question PDA for the same rule hash", () => {
    const a = createStubChainAdapter({ clock });
    const b = createStubChainAdapter({ clock });
    expect(a.deriveQuestionPda("f".repeat(64))).toBe(b.deriveQuestionPda("f".repeat(64)));
  });

  it("derives different question PDAs for different rule hashes", () => {
    const adapter = createStubChainAdapter({ clock });
    expect(adapter.deriveQuestionPda("a".repeat(64))).not.toBe(
      adapter.deriveQuestionPda("b".repeat(64)),
    );
  });

  it("derives base58 PDAs that fit the 44-char address columns", () => {
    const adapter = createStubChainAdapter({ clock });
    const questionPda = adapter.deriveQuestionPda("c".repeat(64));
    const batchPda = adapter.deriveBatchPda(WALLET);
    for (const pda of [questionPda, batchPda]) {
      expect(pda).toMatch(BASE58);
      expect(pda.length).toBeLessThanOrEqual(44);
    }
  });

  it("derives the batch PDA from the wallet deterministically", () => {
    const adapter = createStubChainAdapter({ clock });
    expect(adapter.deriveBatchPda(WALLET)).toBe(adapter.deriveBatchPda(WALLET));
    expect(adapter.deriveBatchPda(WALLET)).not.toBe(
      adapter.deriveBatchPda("5".repeat(43)),
    );
  });
});

describe("stub createQuestion", () => {
  it("stores the question and returns its deterministic PDA", async () => {
    const adapter = createStubChainAdapter({ clock });
    const { pda } = await adapter.createQuestion(rule());
    expect(pda).toBe(adapter.deriveQuestionPda(rule().ruleHash));

    const question = await adapter.getQuestion(pda);
    expect(question).toMatchObject({
      pda,
      fixtureId: "fixture-1",
      status: "open",
      result: null,
    });
  });

  it("stamps its own authority pubkey on the created question", async () => {
    const adapter = createStubChainAdapter({ clock });
    const { pda } = await adapter.createQuestion(rule());
    const question = await adapter.getQuestion(pda);
    expect(question?.authority).toBe(adapter.authorityPubkey);
    expect(adapter.authorityPubkey).toMatch(BASE58);
  });

  it("refuses to create the same rule twice (account already in use)", async () => {
    const adapter = createStubChainAdapter({ clock });
    await adapter.createQuestion(rule());
    await expect(adapter.createQuestion(rule())).rejects.toMatchObject({
      code: "question_exists",
    });
  });

  it("rejects locks_at <= opens_at", async () => {
    const adapter = createStubChainAdapter({ clock });
    await expect(
      adapter.createQuestion(rule({ locksAt: rule().opensAt })),
    ).rejects.toMatchObject({ code: "invalid_window" });
  });
});

describe("stub submitBatch", () => {
  const HASH = "b".repeat(64);

  it("stores one batch and returns pda + signature", async () => {
    const adapter = createStubChainAdapter({ clock });

    const { pda, signature } = await adapter.submitBatch({
      wallet: WALLET,
      batchHash: HASH,
    });

    expect(pda).toBe(adapter.deriveBatchPda(WALLET));
    expect(signature).toMatch(BASE58);
    expect(signature.length).toBeLessThanOrEqual(88);

    const batch = await adapter.getBatch(pda);
    expect(batch).toMatchObject({
      pda,
      wallet: WALLET,
      batchHash: HASH,
      signature,
      submittedAt: now,
    });
  });

  it("rejects a second batch for the same wallet", async () => {
    const adapter = createStubChainAdapter({ clock });
    await adapter.submitBatch({ wallet: WALLET, batchHash: HASH });

    await expect(
      adapter.submitBatch({ wallet: WALLET, batchHash: "c".repeat(64) }),
    ).rejects.toMatchObject({ code: "batch_exists" });

    const batch = await adapter.getBatch(adapter.deriveBatchPda(WALLET));
    expect(batch?.batchHash).toBe(HASH);
  });

  it("allows different wallets to each submit a batch", async () => {
    const adapter = createStubChainAdapter({ clock });
    await adapter.submitBatch({ wallet: WALLET, batchHash: HASH });
    await expect(
      adapter.submitBatch({ wallet: "4".repeat(43), batchHash: HASH }),
    ).resolves.toBeDefined();
  });
});

describe("stub settleQuestion", () => {
  it("settles once and stores the result", async () => {
    const adapter = createStubChainAdapter({ clock });
    const { pda: questionPda } = await adapter.createQuestion(rule());

    const { signature } = await adapter.settleQuestion({ questionPda, result: "push" });
    expect(signature).toMatch(BASE58);

    const question = await adapter.getQuestion(questionPda);
    expect(question).toMatchObject({ status: "settled", result: "push" });
  });

  it("refuses a second settlement", async () => {
    const adapter = createStubChainAdapter({ clock });
    const { pda: questionPda } = await adapter.createQuestion(rule());
    await adapter.settleQuestion({ questionPda, result: "yes" });

    await expect(
      adapter.settleQuestion({ questionPda, result: "no" }),
    ).rejects.toMatchObject({ code: "already_settled" });

    const question = await adapter.getQuestion(questionPda);
    expect(question?.result).toBe("yes");
  });
});

describe("stub reads", () => {
  it("returns null for unknown PDAs", async () => {
    const adapter = createStubChainAdapter({ clock });
    expect(await adapter.getQuestion("unknown")).toBeNull();
    expect(await adapter.getBatch("unknown")).toBeNull();
  });
});

describe("ChainError", () => {
  it("carries a stable code", () => {
    const error = new ChainError("batch_exists");
    expect(error.code).toBe("batch_exists");
    expect(error).toBeInstanceOf(Error);
  });
});
