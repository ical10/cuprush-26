import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  fixtures,
  participants,
  predictionBatches,
  predictions,
  questions,
} from "../db/schema";
import { isChainError, type ChainAdapter, type ChainQuestionResult } from "../chain";
import { ensureQuestionOnChain, retryDelayMs } from "../predictions/reconciler";
import { evaluateQuestion } from "./evaluate";
import { isSettlingOverdue } from "./scheduler";
import type { TemplateId } from "./types";

/**
 * Settlement executor (issue 9): the second half of the question lifecycle
 * scheduler.ts started — moving "settling" questions to "settled" and
 * scoring their predictions, exactly once, under retries and crashes.
 *
 * Mirrors src/predictions/reconciler.ts's shape: claim due rows with a
 * conditional UPDATE, evaluate/settle/repair without ever inventing a
 * result, schedule capped-exponential backoff on anything that isn't
 * ready yet, and do the settle+score write as one Postgres transaction so
 * a rerun is safe.
 */

type QuestionRow = typeof questions.$inferSelect;

async function scheduleRetry(
  db: Database,
  question: Pick<QuestionRow, "id" | "attemptCount">,
  error: unknown,
  now: Date,
): Promise<void> {
  const attemptCount = question.attemptCount + 1;
  await db
    .update(questions)
    .set({
      attemptCount,
      nextRetryAt: new Date(now.getTime() + retryDelayMs(attemptCount)),
      lastError: error instanceof Error ? error.message : String(error),
    })
    .where(and(eq(questions.id, question.id), eq(questions.status, "settling")));
}

/** Settle + score in one transaction; a rerun on an already-settled question is a no-op. */
async function commitSettlement(
  db: Database,
  question: QuestionRow,
  result: ChainQuestionResult,
  signature: string,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [settled] = await tx
      .update(questions)
      .set({
        status: "settled",
        result,
        settledAt: now,
        settlementSignature: signature,
        nextRetryAt: null,
        lastError: null,
      })
      .where(and(eq(questions.id, question.id), eq(questions.status, "settling")))
      .returning({ id: questions.id });

    if (!settled) return; // already settled by a previous pass

    // Only score predictions whose parent batch confirmed on chain (the
    // batch carries the commitment now, not the per-prediction row).
    const confirmedRows = await tx
      .select({ prediction: predictions })
      .from(predictions)
      .innerJoin(predictionBatches, eq(predictions.batchId, predictionBatches.id))
      .where(
        and(
          eq(predictions.questionId, question.id),
          eq(predictionBatches.chainStatus, "confirmed"),
          isNull(predictions.scoredAt),
        ),
      );
    const confirmed = confirmedRows.map((row) => row.prediction);

    for (const prediction of confirmed) {
      if (result === "push") {
        await tx
          .update(predictions)
          .set({ scoredAt: now })
          .where(and(eq(predictions.id, prediction.id), isNull(predictions.scoredAt)));
        continue;
      }

      const correct = prediction.outcome === result;
      await tx
        .update(predictions)
        .set({ scoredAt: now })
        .where(and(eq(predictions.id, prediction.id), isNull(predictions.scoredAt)));

      if (correct) {
        const newStreak = sql`${participants.currentStreak} + 1`;
        await tx
          .update(participants)
          .set({
            points: sql`${participants.points} + 1`,
            currentStreak: newStreak,
            bestStreak: sql`greatest(${participants.bestStreak}, ${participants.currentStreak} + 1)`,
          })
          .where(eq(participants.id, prediction.participantId));
      } else {
        await tx
          .update(participants)
          .set({ currentStreak: 0 })
          .where(eq(participants.id, prediction.participantId));
      }
    }
  });
}

export type SettlementExecutorOptions = {
  db: Database;
  chain: ChainAdapter;
  clock?: () => Date;
};

export type SettlementRunResult = {
  scanned: number;
  settled: number;
  retried: number;
};

export type SettlementExecutor = {
  start(): void;
  stop(): void;
  runOnce(): Promise<SettlementRunResult>;
};

export function createSettlementExecutor(options: SettlementExecutorOptions): SettlementExecutor {
  const { db, chain } = options;
  const clock = options.clock ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;

  async function runOnce(): Promise<SettlementRunResult> {
    const now = clock();
    const due = await db
      .select()
      .from(questions)
      .where(
        and(
          eq(questions.status, "settling"),
          or(isNull(questions.nextRetryAt), lte(questions.nextRetryAt, now)),
        ),
      );

    const result: SettlementRunResult = { scanned: due.length, settled: 0, retried: 0 };

    for (const question of due) {
      // Claim: bump attempt_count on a conditional UPDATE keyed on the
      // still-settling status, so a concurrent pass racing on the same row
      // only has one winner — the loser's row no longer matches
      // attemptCount and its subsequent writes are no-ops against the
      // now-different expected state.
      const [claimed] = await db
        .update(questions)
        .set({ attemptCount: question.attemptCount + 1 })
        .where(
          and(
            eq(questions.id, question.id),
            eq(questions.status, "settling"),
            eq(questions.attemptCount, question.attemptCount),
          ),
        )
        .returning();
      if (!claimed) continue; // lost the claim race to another pass

      if (isSettlingOverdue(claimed.settlingAt, now)) {
        console.error(
          JSON.stringify({
            event: "settlement_overdue",
            questionId: claimed.id,
            settlingAt: claimed.settlingAt,
          }),
        );
      }

      try {
        const settled = await settleOne(db, chain, claimed, now);
        if (settled) result.settled += 1;
        else result.retried += 1;
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "settlement_error",
            questionId: claimed.id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        await scheduleRetry(db, claimed, error, now);
        result.retried += 1;
      }
    }
    return result;
  }

  return {
    start() {
      void runOnce();
      timer = setInterval(() => void runOnce(), 60_000);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    runOnce,
  };
}

async function settleOne(
  db: Database,
  chain: ChainAdapter,
  question: QuestionRow,
  now: Date,
): Promise<boolean> {
  const [fixture] = await db.select().from(fixtures).where(eq(fixtures.id, question.fixtureId));
  if (!fixture) {
    await scheduleRetry(db, question, new Error("fixture not found"), now);
    return false;
  }

  const evaluated = evaluateQuestion(question.template as TemplateId, question, fixture.stats);
  if (evaluated.status === "not_ready") {
    await scheduleRetry(db, question, new Error("fixture stats not yet available"), now);
    return false;
  }

  // The question account must exist on chain to settle against. Batches no
  // longer create it (they commit a hash keyed by wallet), so settlement is
  // now the path that lazily creates + records the Question PDA.
  let questionPda: string;
  try {
    questionPda = await ensureQuestionOnChain(db, chain, question);
  } catch (error) {
    await scheduleRetry(db, question, error, now);
    return false;
  }

  try {
    const { signature } = await chain.settleQuestion({
      questionPda,
      result: evaluated.result,
    });
    await commitSettlement(db, question, evaluated.result, signature, now);
    return true;
  } catch (error) {
    if (isChainError(error, "already_settled")) {
      // Crash-repair: chain settled already but Postgres crashed before
      // committing. Chain is the source of truth — use its recorded
      // result, not a fresh re-derivation from stats.
      const onChain = await chain.getQuestion(questionPda);
      if (onChain?.result) {
        await commitSettlement(
          db,
          question,
          onChain.result,
          question.settlementSignature ?? "repaired",
          now,
        );
        return true;
      }
    }
    throw error;
  }
}
