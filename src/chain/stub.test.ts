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
    const predictionPda = adapter.derivePredictionPda(questionPda, WALLET);
    for (const pda of [questionPda, predictionPda]) {
      expect(pda).toMatch(BASE58);
      expect(pda.length).toBeLessThanOrEqual(44);
    }
  });

  it("derives the prediction PDA from (question, wallet) deterministically", () => {
    const adapter = createStubChainAdapter({ clock });
    const questionPda = adapter.deriveQuestionPda("d".repeat(64));
    expect(adapter.derivePredictionPda(questionPda, WALLET)).toBe(
      adapter.derivePredictionPda(questionPda, WALLET),
    );
    expect(adapter.derivePredictionPda(questionPda, WALLET)).not.toBe(
      adapter.derivePredictionPda(questionPda, "5".repeat(43)),
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

describe("stub submitPrediction", () => {
  it("stores one prediction and returns pda + signature", async () => {
    const adapter = createStubChainAdapter({ clock });
    const { pda: questionPda } = await adapter.createQuestion(rule());

    const { pda, signature } = await adapter.submitPrediction({
      questionPda,
      wallet: WALLET,
      outcome: "yes",
    });

    expect(pda).toBe(adapter.derivePredictionPda(questionPda, WALLET));
    expect(signature).toMatch(BASE58);
    expect(signature.length).toBeLessThanOrEqual(88);

    const prediction = await adapter.getPrediction(pda);
    expect(prediction).toMatchObject({
      pda,
      questionPda,
      wallet: WALLET,
      outcome: "yes",
      signature,
      submittedAt: now,
    });
  });

  it("rejects a second prediction for the same wallet and question", async () => {
    const adapter = createStubChainAdapter({ clock });
    const { pda: questionPda } = await adapter.createQuestion(rule());
    await adapter.submitPrediction({ questionPda, wallet: WALLET, outcome: "yes" });

    await expect(
      adapter.submitPrediction({ questionPda, wallet: WALLET, outcome: "no" }),
    ).rejects.toMatchObject({ code: "prediction_exists" });

    const prediction = await adapter.getPrediction(
      adapter.derivePredictionPda(questionPda, WALLET),
    );
    expect(prediction?.outcome).toBe("yes");
  });

  it("allows different wallets to predict on the same question", async () => {
    const adapter = createStubChainAdapter({ clock });
    const { pda: questionPda } = await adapter.createQuestion(rule());
    await adapter.submitPrediction({ questionPda, wallet: WALLET, outcome: "yes" });
    await expect(
      adapter.submitPrediction({ questionPda, wallet: "4".repeat(43), outcome: "no" }),
    ).resolves.toBeDefined();
  });

  it("rejects before opens_at", async () => {
    const adapter = createStubChainAdapter({ clock });
    const { pda: questionPda } = await adapter.createQuestion(
      rule({ opensAt: new Date(now.getTime() + 1), locksAt: new Date(now.getTime() + 60_000) }),
    );
    await expect(
      adapter.submitPrediction({ questionPda, wallet: WALLET, outcome: "yes" }),
    ).rejects.toMatchObject({ code: "before_open" });
  });

  it("rejects at and after locks_at", async () => {
    const adapter = createStubChainAdapter({ clock });
    const { pda: questionPda } = await adapter.createQuestion(
      rule({ opensAt: new Date(now.getTime() - 60_000), locksAt: now }),
    );
    await expect(
      adapter.submitPrediction({ questionPda, wallet: WALLET, outcome: "yes" }),
    ).rejects.toMatchObject({ code: "after_lock" });
  });

  it("accepts exactly at opens_at", async () => {
    const adapter = createStubChainAdapter({ clock });
    const { pda: questionPda } = await adapter.createQuestion(
      rule({ opensAt: now, locksAt: new Date(now.getTime() + 1) }),
    );
    await expect(
      adapter.submitPrediction({ questionPda, wallet: WALLET, outcome: "yes" }),
    ).resolves.toBeDefined();
  });

  it("rejects an unknown question", async () => {
    const adapter = createStubChainAdapter({ clock });
    await expect(
      adapter.submitPrediction({
        questionPda: adapter.deriveQuestionPda("e".repeat(64)),
        wallet: WALLET,
        outcome: "yes",
      }),
    ).rejects.toMatchObject({ code: "question_not_found" });
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

  it("refuses predictions on a settled question even inside the window", async () => {
    const adapter = createStubChainAdapter({ clock });
    const { pda: questionPda } = await adapter.createQuestion(rule());
    await adapter.settleQuestion({ questionPda, result: "yes" });

    await expect(
      adapter.submitPrediction({ questionPda, wallet: WALLET, outcome: "yes" }),
    ).rejects.toMatchObject({ code: "question_not_open" });
  });
});

describe("stub reads", () => {
  it("returns null for unknown PDAs", async () => {
    const adapter = createStubChainAdapter({ clock });
    expect(await adapter.getQuestion("unknown")).toBeNull();
    expect(await adapter.getPrediction("unknown")).toBeNull();
  });
});

describe("ChainError", () => {
  it("carries a stable code", () => {
    const error = new ChainError("after_lock");
    expect(error.code).toBe("after_lock");
    expect(error).toBeInstanceOf(Error);
  });
});
