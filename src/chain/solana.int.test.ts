import { randomBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import { isChainError, type ChainAdapter, type ChainQuestionRule } from "./adapter";
import { createSolanaChainAdapter } from "./solana";

/**
 * Real devnet round trip against the deployed cuprush program. Auto
 * skips unless CUPRUSH_PROGRAM_ID and SOLANA_PRIVATE_KEY are set (the private
 * key must belong to a funded devnet wallet — it pays rent and fees).
 * Every run uses a fresh random rule hash and a throwaway wallet, so runs
 * never collide with each other on chain.
 */

const configured = Boolean(
  process.env.CUPRUSH_PROGRAM_ID && process.env.SOLANA_PRIVATE_KEY,
);

const TX_TIMEOUT_MS = 120_000;

describe.skipIf(!configured)("solana adapter on devnet", () => {
  let adapter: ChainAdapter;

  beforeAll(() => {
    adapter = createSolanaChainAdapter(process.env);
  });

  it(
    "creates, reads, and settles a question exactly once",
    { timeout: TX_TIMEOUT_MS },
    async () => {
      const now = Date.now();
      const rule: ChainQuestionRule = {
        ruleHash: randomBytes(32).toString("hex"),
        fixtureId: `int-${now}`,
        benchmarkFixtureId: null,
        statKey1: "home.full_time.goals",
        statKey2: "away.full_time.goals",
        operator: "subtract",
        comparison: "greater_than",
        threshold: 0,
        benchmarkValue: null,
        opensAt: new Date(now - 60_000),
        locksAt: new Date(now + 60 * 60_000),
      };

      const { pda } = await adapter.createQuestion(rule);
      expect(pda).toBe(adapter.deriveQuestionPda(rule.ruleHash));

      const onChain = await adapter.getQuestion(pda);
      expect(onChain).toMatchObject({
        pda,
        ruleHash: rule.ruleHash,
        fixtureId: rule.fixtureId,
        statKey1: rule.statKey1,
        statKey2: rule.statKey2,
        operator: "subtract",
        comparison: "greater_than",
        threshold: 0,
        benchmarkValue: null,
        status: "open",
        result: null,
      });
      expect(onChain?.opensAt.getTime()).toBe(
        Math.floor(rule.opensAt.getTime() / 1000) * 1000,
      );

      await expect(adapter.createQuestion(rule)).rejects.toSatisfy((error) =>
        isChainError(error, "question_exists"),
      );

      const { signature } = await adapter.settleQuestion({
        questionPda: pda,
        result: "push",
      });
      expect(signature).toBeTypeOf("string");

      const settled = await adapter.getQuestion(pda);
      expect(settled).toMatchObject({ status: "settled", result: "push" });

      await expect(
        adapter.settleQuestion({ questionPda: pda, result: "yes" }),
      ).rejects.toSatisfy((error) => isChainError(error, "already_settled"));
    },
  );

  it(
    "commits one immutable batch per (wallet, fixture) and reads it back",
    { timeout: TX_TIMEOUT_MS },
    async () => {
      const wallet = Keypair.generate().publicKey.toBase58();
      const fixtureId = `int-batch-${Date.now()}`;
      const batchHash = randomBytes(32).toString("hex");

      const { pda, signature } = await adapter.submitBatch({
        wallet,
        fixtureId,
        batchHash,
      });
      expect(pda).toBe(adapter.deriveBatchPda(wallet, fixtureId));
      expect(signature).toBeTypeOf("string");

      const onChain = await adapter.getBatch(wallet, fixtureId);
      expect(onChain).toMatchObject({ pda, wallet, fixtureId, batchHash, signature });
      expect(onChain?.submittedAt).toBeInstanceOf(Date);

      await expect(
        adapter.submitBatch({
          wallet,
          fixtureId,
          batchHash: randomBytes(32).toString("hex"),
        }),
      ).rejects.toSatisfy((error) => isChainError(error, "batch_exists"));

      const untouched = await adapter.getBatch(wallet, fixtureId);
      expect(untouched?.batchHash).toBe(batchHash);

      // A different fixture for the same wallet is a fresh, independent batch.
      const otherFixture = `${fixtureId}-b`;
      const other = await adapter.submitBatch({
        wallet,
        fixtureId: otherFixture,
        batchHash: randomBytes(32).toString("hex"),
      });
      expect(other.pda).not.toBe(pda);
    },
  );
});
