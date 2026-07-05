import { and, eq, isNull, lte, or } from "drizzle-orm";
import type { Database } from "../db/client";
import { participants, predictionBatches, questions } from "../db/schema";
import { isChainError, type ChainAdapter, type ChainBatch } from "../chain";

/**
 * Postgres <-> chain state machine for prediction batches (research doc
 * "Idempotency, ordering, and recovery", batched variant). One batch per
 * participant carries the on-chain commitment for their whole deck, so the
 * dual-write retry logic lives here at the batch level:
 *
 * - Postgres-first crash (batch row pending, chain never reached): retry the
 *   sponsored submission with capped exponential backoff.
 * - Chain-first crash (batch on chain, row still pending): the Batch PDA is
 *   deterministic from the wallet, so a reconciler pass reads it back and
 *   repairs the row to confirmed.
 *
 * `submitPendingBatch` is the single submit path used by both the API route
 * (first attempt) and the periodic reconciler (retries + repair).
 */

type QuestionRow = typeof questions.$inferSelect;
type BatchRow = typeof predictionBatches.$inferSelect;

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
 * Batches don't reference questions on chain, so settlement (which needs a
 * question account to settle against) is now the caller of this.
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
  batchId: string,
  chain: Pick<ChainBatch, "pda" | "signature" | "submittedAt">,
  now: Date,
): Promise<void> {
  await db
    .update(predictionBatches)
    .set({
      chainStatus: "confirmed",
      batchPda: chain.pda,
      signature: chain.signature,
      submittedAt: chain.submittedAt,
      confirmedAt: now,
      nextRetryAt: null,
      lastError: null,
    })
    .where(
      and(eq(predictionBatches.id, batchId), eq(predictionBatches.chainStatus, "pending")),
    );
}

async function scheduleRetry(
  db: Database,
  batch: Pick<BatchRow, "id" | "attemptCount">,
  error: unknown,
  now: Date,
): Promise<void> {
  const attemptCount = batch.attemptCount + 1;
  await db
    .update(predictionBatches)
    .set({
      attemptCount,
      nextRetryAt: new Date(now.getTime() + retryDelayMs(attemptCount)),
      lastError: error instanceof Error ? error.message : String(error),
    })
    .where(
      and(eq(predictionBatches.id, batch.id), eq(predictionBatches.chainStatus, "pending")),
    );
}

/**
 * One idempotent chain-submit attempt for a pending batch. Never throws:
 * success (or discovering the batch already on chain) confirms the row; any
 * chain failure schedules a backed-off retry and leaves the row pending for
 * the reconciler.
 */
export async function submitPendingBatch(
  db: Database,
  adapter: ChainAdapter,
  input: {
    batch: BatchRow;
    wallet: string;
    now?: Date;
  },
): Promise<"confirmed" | "pending"> {
  const { batch, wallet } = input;
  const now = input.now ?? new Date();

  try {
    const batchPda = adapter.deriveBatchPda(wallet);

    // Chain-first crash repair: the deterministic PDA may already hold this
    // batch even though the row is still pending.
    const existing = await adapter.getBatch(batchPda);
    if (existing) {
      await markConfirmed(db, batch.id, existing, now);
      return "confirmed";
    }

    const { pda, signature } = await adapter.submitBatch({
      wallet,
      batchHash: batch.batchHash,
    });
    await markConfirmed(db, batch.id, { pda, signature, submittedAt: now }, now);
    return "confirmed";
  } catch (error) {
    if (isChainError(error, "batch_exists")) {
      // Raced with another submit of the same batch: read it back.
      const onChain = await adapter.getBatch(adapter.deriveBatchPda(wallet));
      if (onChain) {
        await markConfirmed(db, batch.id, onChain, now);
        return "confirmed";
      }
    }
    await scheduleRetry(db, batch, error, now);
    return "pending";
  }
}

export type ReconcileResult = {
  scanned: number;
  confirmed: number;
  retried: number;
};

/**
 * One reconciler pass: retries due pending batches and repairs rows whose
 * batch already reached the chain.
 */
export async function reconcilePendingBatches(
  db: Database,
  adapter: ChainAdapter,
  now = new Date(),
): Promise<ReconcileResult> {
  const due = await db
    .select({
      batch: predictionBatches,
      wallet: participants.walletAddress,
    })
    .from(predictionBatches)
    .innerJoin(participants, eq(predictionBatches.participantId, participants.id))
    .where(
      and(
        eq(predictionBatches.chainStatus, "pending"),
        or(isNull(predictionBatches.nextRetryAt), lte(predictionBatches.nextRetryAt, now)),
      ),
    );

  const result: ReconcileResult = { scanned: due.length, confirmed: 0, retried: 0 };

  for (const row of due) {
    try {
      if (!row.wallet) {
        // Unreachable through the API (a wallet is required to submit), but a
        // row without one can only wait — retry until it appears.
        await scheduleRetry(db, row.batch, new Error("participant has no wallet"), now);
        result.retried += 1;
        continue;
      }
      const outcome = await submitPendingBatch(db, adapter, {
        batch: row.batch,
        wallet: row.wallet,
        now,
      });
      result[outcome === "confirmed" ? "confirmed" : "retried"] += 1;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "batch_reconcile_error",
          batchId: row.batch.id,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  return result;
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
    reconcilePendingBatches(options.db, options.adapter, clock());

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
