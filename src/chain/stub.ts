import { createHash } from "node:crypto";
import {
  ChainError,
  type ChainAdapter,
  type ChainOutcome,
  type ChainPrediction,
  type ChainQuestion,
  type ChainQuestionResult,
  type ChainQuestionRule,
} from "./adapter";

/**
 * In-memory chain stub. Mirrors the program's behaviour exactly where the
 * app depends on it: deterministic PDAs from the same seed scheme
 * ([b"question", rule_hash] / [b"prediction", question, wallet], sha256
 * instead of Solana's PDA hash), one immutable prediction per (question,
 * wallet), on-"chain" opens_at/locks_at enforcement, and single settlement.
 * State lives for the process lifetime only — Postgres plus the reconciler
 * own durability, exactly as they must against the real chain.
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

export function createStubChainAdapter(
  options: StubChainAdapterOptions = {},
): ChainAdapter {
  const clock = options.clock ?? (() => new Date());
  const questions = new Map<string, ChainQuestion>();
  const predictions = new Map<string, ChainPrediction>();

  function deriveQuestionPda(ruleHash: string): string {
    return fakeAddress("question", Buffer.from(ruleHash, "hex"));
  }

  function derivePredictionPda(questionPda: string, wallet: string): string {
    return fakeAddress("prediction", questionPda, wallet);
  }

  return {
    deriveQuestionPda,
    derivePredictionPda,

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
      questions.set(pda, { ...rule, pda, status: "open", result: null });
      return Promise.resolve({ pda });
    },

    submitPrediction(input: {
      questionPda: string;
      wallet: string;
      outcome: ChainOutcome;
    }) {
      const question = questions.get(input.questionPda);
      if (!question) {
        return Promise.reject(
          new ChainError("question_not_found", input.questionPda),
        );
      }
      if (question.status !== "open") {
        return Promise.reject(new ChainError("question_not_open"));
      }
      const now = clock().getTime();
      if (now < question.opensAt.getTime()) {
        return Promise.reject(new ChainError("before_open"));
      }
      if (now >= question.locksAt.getTime()) {
        return Promise.reject(new ChainError("after_lock"));
      }

      const pda = derivePredictionPda(input.questionPda, input.wallet);
      if (predictions.has(pda)) {
        return Promise.reject(
          new ChainError("prediction_exists", `prediction account in use: ${pda}`),
        );
      }

      const signature = fakeSignature("submit_prediction", pda);
      predictions.set(pda, {
        pda,
        questionPda: input.questionPda,
        wallet: input.wallet,
        outcome: input.outcome,
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

    getPrediction(pda: string) {
      const prediction = predictions.get(pda);
      return Promise.resolve(prediction ? { ...prediction } : null);
    },
  };
}
