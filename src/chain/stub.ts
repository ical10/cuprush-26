import { createHash } from "node:crypto";
import {
  ChainError,
  assertBatchFixtureId,
  type ChainAdapter,
  type ChainBatch,
  type ChainQuestion,
  type ChainQuestionResult,
  type ChainQuestionRule,
} from "./adapter";

/**
 * In-memory chain stub. Mirrors the program's behaviour exactly where the
 * app depends on it: deterministic PDAs from the same seed scheme
 * ([b"question", rule_hash] / [b"batch", wallet], sha256 instead of Solana's
 * PDA hash), one immutable batch per wallet, and single settlement. State
 * lives for the process lifetime only — Postgres plus the reconciler own
 * durability, exactly as they must against the real chain.
 *
 * The stub only speaks v2 (per-fixture) batches — it has no legacy v1 state,
 * so `getLegacyBatch` always returns null.
 */

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Buffer): string {
  let n = BigInt(`0x${bytes.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = BASE58_ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

function sha256(...parts: (string | Buffer)[]): Buffer {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/** 32 bytes -> base58, like a Solana address (<= 44 chars). */
function fakeAddress(...seeds: (string | Buffer)[]): string {
  return base58(sha256(...seeds));
}

/** 64 bytes -> base58, like a transaction signature (<= 88 chars). */
function fakeSignature(...seeds: (string | Buffer)[]): string {
  const first = sha256("sig:0", ...seeds);
  const second = sha256("sig:1", ...seeds);
  return base58(Buffer.concat([first, second]));
}

export type StubChainAdapterOptions = {
  clock?: () => Date;
};

/** Fixed stand-in for the signing authority (base58, address-shaped). */
const STUB_AUTHORITY = fakeAddress("stub-authority");

export function createStubChainAdapter(
  options: StubChainAdapterOptions = {},
): ChainAdapter {
  const clock = options.clock ?? (() => new Date());
  const questions = new Map<string, ChainQuestion>();
  const batches = new Map<string, ChainBatch>();

  function deriveQuestionPda(ruleHash: string): string {
    return fakeAddress("question", Buffer.from(ruleHash, "hex"));
  }

  function deriveBatchPda(wallet: string, fixtureId: string): string {
    assertBatchFixtureId(fixtureId);
    return fakeAddress("batch", wallet, fixtureId);
  }

  return {
    authorityPubkey: STUB_AUTHORITY,
    deriveQuestionPda,
    deriveBatchPda,

    createQuestion(rule: ChainQuestionRule) {
      if (rule.locksAt.getTime() <= rule.opensAt.getTime()) {
        return Promise.reject(
          new ChainError("invalid_window", "locks_at must be after opens_at"),
        );
      }
      const pda = deriveQuestionPda(rule.ruleHash);
      if (questions.has(pda)) {
        return Promise.reject(
          new ChainError("question_exists", `question account in use: ${pda}`),
        );
      }
      questions.set(pda, {
        ...rule,
        pda,
        authority: STUB_AUTHORITY,
        status: "open",
        result: null,
      });
      return Promise.resolve({ pda });
    },

    submitBatch(input: { wallet: string; fixtureId: string; batchHash: string }) {
      let pda: string;
      try {
        pda = deriveBatchPda(input.wallet, input.fixtureId);
      } catch (error) {
        return Promise.reject(error);
      }
      if (batches.has(pda)) {
        return Promise.reject(
          new ChainError("batch_exists", `batch account in use: ${pda}`),
        );
      }

      const signature = fakeSignature("submit_batch", pda);
      batches.set(pda, {
        pda,
        wallet: input.wallet,
        fixtureId: input.fixtureId,
        batchHash: input.batchHash,
        signature,
        submittedAt: clock(),
      });
      return Promise.resolve({ pda, signature });
    },

    settleQuestion(input: { questionPda: string; result: ChainQuestionResult }) {
      const question = questions.get(input.questionPda);
      if (!question) {
        return Promise.reject(
          new ChainError("question_not_found", input.questionPda),
        );
      }
      if (question.status === "settled") {
        return Promise.reject(new ChainError("already_settled"));
      }
      question.status = "settled";
      question.result = input.result;
      return Promise.resolve({
        signature: fakeSignature("settle_question", input.questionPda),
      });
    },

    getQuestion(pda: string) {
      const question = questions.get(pda);
      return Promise.resolve(question ? { ...question } : null);
    },

    getBatch(wallet: string, fixtureId: string) {
      let pda: string;
      try {
        pda = deriveBatchPda(wallet, fixtureId);
      } catch (error) {
        return Promise.reject(error);
      }
      const batch = batches.get(pda);
      return Promise.resolve(batch ? { ...batch } : null);
    },

    // The stub has no legacy v1 commitments; everything it stores is v2.
    getLegacyBatch(_wallet: string) {
      return Promise.resolve(null);
    },
  };
}
