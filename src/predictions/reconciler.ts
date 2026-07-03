import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { Database } from "../db/client";
import { participants, predictions, questions } from "../db/schema";
import { isChainError, type ChainAdapter, type ChainPrediction } from "../chain";

/**
 * Postgres <-> chain state machine for predictions (research doc
 * "Idempotency, ordering, and recovery"). Every dual write is safe to
 * retry:
 *
 * - Postgres-first crash (row pending, chain never reached): retry the
 *   sponsored submission with capped exponential backoff until the question
 *   locks, then mark the row failed.
 * - Chain-first crash (prediction on chain, row still pending): the
 *   Prediction PDA is deterministic from (question, wallet), so a reconciler
 *   pass reads it back and repairs the row to confirmed.
 *
 * `submitPendingPrediction` is the single submit path used by both the API
 * route (first attempt) and the periodic reconciler (retries + repair).
 */

type QuestionRow = typeof questions.$inferSelect;
type PredictionRow = typeof predictions.$inferSelect;

export const BASE_RETRY_DELAY_MS = 30_000;
export const MAX_RETRY_DELAY_MS = 10 * 60_000;

/** Capped exponential backoff: 30s, 60s, 120s, ... capped at 10 minutes. */
export function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(attemptCount - 1, 0);
  return Math.min(BASE_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS);
}

/**
 * Guarantees the Question account exists on chain and its PDA is recorded
 * on the questions row. Idempotent: the PDA is deterministic from the rule
 * hash, and a concurrent create losing the race is treated as success.
 */
export async function ensureQuestionOnChain(
  db: Database,
  adapter: ChainAdapter,
  question: QuestionRow,
): Promise<string> {
  if (question.questionPda) return question.questionPda;

  const pda = adapter.deriveQuestionPda(question.ruleHash);
  const existing = await adapter.getQuestion(pda);
  if (!existing) {
    try {
      await adapter.createQuestion({
        ruleHash: question.ruleHash,
        fixtureId: question.fixtureId,
        benchmarkFixtureId: question.benchmarkFixtureId,
        statKey1: question.statKey1,
        statKey2: question.statKey2,
        operator: question.operator,
        comparison: question.comparison,
        threshold: question.threshold,
        benchmarkValue: question.benchmarkValue,
        opensAt: question.opensAt,
        locksAt: question.locksAt,
      });
    } catch (error) {
      // Lost a create race: the account exists, which is all we need.
      if (!isChainError(error, "question_exists")) throw error;
    }
  }

  await db
    .update(questions)
    .set({ questionPda: pda })
    .where(and(eq(questions.id, question.id), isNull(questions.questionPda)));
  return pda;
}

/** Conditional pending->confirmed update; a repeat call is a no-op. */
async function markConfirmed(
  db: Database,
  predictionId: string,
  chain: Pick<ChainPrediction, "pda" | "signature" | "submittedAt">,
  now: Date,
): Promise<void> {
  await db
    .update(predictions)
    .set({
      chainStatus: "confirmed",
      predictionPda: chain.pda,
      signature: chain.signature,
      submittedAt: chain.submittedAt,
      confirmedAt: now,
      nextRetryAt: null,
      lastError: null,
    })
    .where(
      and(eq(predictions.id, predictionId), eq(predictions.chainStatus, "pending")),
    );
}

async function scheduleRetry(
  db: Database,
  prediction: Pick<PredictionRow, "id" | "attemptCount">,
  error: unknown,
  now: Date,
): Promise<void> {
  const attemptCount = prediction.attemptCount + 1;
  await db
    .update(predictions)
    .set({
      attemptCount,
      nextRetryAt: new Date(now.getTime() + retryDelayMs(attemptCount)),
      lastError: error instanceof Error ? error.message : String(error),
    })
    .where(
      and(eq(predictions.id, prediction.id), eq(predictions.chainStatus, "pending")),
    );
}

async function markFailed(
  db: Database,
  predictionId: string,
  reason: string,
): Promise<void> {
  await db
    .update(predictions)
    .set({ chainStatus: "failed", nextRetryAt: null, lastError: reason })
    .where(
      and(eq(predictions.id, predictionId), eq(predictions.chainStatus, "pending")),
    );
}

/**
 * One idempotent chain-submit attempt for a pending row. Never throws:
 * success (or discovering the prediction already on chain) confirms the
 * row; any chain failure schedules a backed-off retry and leaves the row
 * pending for the reconciler.
 */
export async function submitPendingPrediction(
  db: Database,
  adapter: ChainAdapter,
  input: {
    prediction: PredictionRow;
    question: QuestionRow;
    wallet: string;
    now?: Date;
  },
): Promise<"confirmed" | "pending"> {
  const { prediction, question, wallet } = input;
  const now = input.now ?? new Date();

  try {
    const questionPda = await ensureQuestionOnChain(db, adapter, question);
    const predictionPda = adapter.derivePredictionPda(questionPda, wallet);

    // Chain-first crash repair: the deterministic PDA may already hold this
    // prediction even though the row is still pending.
    const existing = await adapter.getPrediction(predictionPda);
    if (existing) {
      await markConfirmed(db, prediction.id, existing, now);
      return "confirmed";
    }

    const { pda, signature } = await adapter.submitPrediction({
      questionPda,
      wallet,
      outcome: prediction.outcome,
    });
    await markConfirmed(db, prediction.id, { pda, signature, submittedAt: now }, now);
    return "confirmed";
  } catch (error) {
    if (isChainError(error, "prediction_exists")) {
      // Raced with another submit of the same prediction: read it back.
      const questionPda =
        question.questionPda ?? adapter.deriveQuestionPda(question.ruleHash);
      const onChain = await adapter.getPrediction(
        adapter.derivePredictionPda(questionPda, wallet),
      );
      if (onChain) {
        await markConfirmed(db, prediction.id, onChain, now);
        return "confirmed";
      }
    }
    await scheduleRetry(db, prediction, error, now);
    return "pending";
  }
}

export type ReconcileResult = {
  scanned: number;
  confirmed: number;
  retried: number;
  failed: number;
};

/**
 * One reconciler pass: retries due pending predictions, repairs rows whose
 * prediction already reached the chain, and fails rows whose question
 * locked before the chain confirmed.
 */
export async function reconcilePendingPredictions(
  db: Database,
  adapter: ChainAdapter,
  now = new Date(),
): Promise<ReconcileResult> {
  const due = await db
    .select({
      prediction: predictions,
      question: questions,
      wallet: participants.walletAddress,
    })
    .from(predictions)
    .innerJoin(questions, eq(predictions.questionId, questions.id))
    .innerJoin(participants, eq(predictions.participantId, participants.id))
    .where(
      and(
        eq(predictions.chainStatus, "pending"),
        or(isNull(predictions.nextRetryAt), lte(predictions.nextRetryAt, now)),
      ),
    );

  const result: ReconcileResult = {
    scanned: due.length,
    confirmed: 0,
    retried: 0,
    failed: 0,
  };

  for (const row of due) {
    try {
      result[await reconcileRow(db, adapter, row, now)] += 1;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "prediction_reconcile_error",
          predictionId: row.prediction.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return result;
}

async function reconcileRow(
  db: Database,
  adapter: ChainAdapter,
  row: { prediction: PredictionRow; question: QuestionRow; wallet: string | null },
  now: Date,
): Promise<"confirmed" | "retried" | "failed"> {
  const locked = now.getTime() >= row.question.locksAt.getTime();

  if (locked) {
    // Last-chance repair: a chain-first crash right before lock may have
    // left the prediction on chain with the row still pending.
    if (row.wallet && row.question.questionPda) {
      const onChain = await adapter.getPrediction(
        adapter.derivePredictionPda(row.question.questionPda, row.wallet),
      );
      if (onChain) {
        await markConfirmed(db, row.prediction.id, onChain, now);
        return "confirmed";
      }
    }
    await markFailed(
      db,
      row.prediction.id,
      "question locked before the prediction reached the chain",
    );
    return "failed";
  }

  if (!row.wallet) {
    // Unreachable through the API (a wallet is required to submit), but a
    // row without one can only wait — retry until the question locks.
    await scheduleRetry(db, row.prediction, new Error("participant has no wallet"), now);
    return "retried";
  }

  const outcome = await submitPendingPrediction(db, adapter, {
    prediction: row.prediction,
    question: row.question,
    wallet: row.wallet,
    now,
  });
  return outcome === "confirmed" ? "confirmed" : "retried";
}

export type PredictionReconcilerOptions = {
  db: Database;
  adapter: ChainAdapter;
  intervalMs?: number;
  clock?: () => Date;
};

export type PredictionReconciler = {
  start(): void;
  stop(): void;
  tick(): Promise<ReconcileResult>;
};

/** One-minute reconciler interval, parallel to the question scheduler. */
export function createPredictionReconciler(
  options: PredictionReconcilerOptions,
): PredictionReconciler {
  const clock = options.clock ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;

  const tick = () =>
    reconcilePendingPredictions(options.db, options.adapter, clock());

  return {
    start() {
      void tick();
      timer = setInterval(() => void tick(), options.intervalMs ?? 60_000);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    tick,
  };
}
