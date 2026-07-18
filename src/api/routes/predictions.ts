import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import {
  fixtures,
  predictionBatches,
  predictions,
  questions,
} from "../../db/schema";
import type { ChainAdapter } from "../../chain";
import {
  createRateLimiter,
  type RateLimiterOptions,
} from "../../chain/guardrails";
import { allowedOutcomes } from "../../questions/templates";
import { computeBatchHash } from "../../predictions/hash";
import { submitPendingBatch } from "../../predictions/reconciler";
import { renderCopy } from "./questions";
import type { AuthAdapter } from "../auth/adapter";
import {
  createAuthMiddleware,
  type AuthEnvBindings,
  type DbProvider,
} from "../auth/middleware";

// The whole deck commits before the first match. Submissions must land
// before this margin ahead of the earliest referenced fixture's kickoff.
const LOCK_MARGIN_MS = 30 * 60_000;

export const postBatchSchema = z.strictObject({
  answers: z
    .array(
      z.strictObject({
        questionId: z.uuid(),
        outcome: z.enum(["yes", "no", "higher", "lower"]),
      }),
    )
    .min(1),
});

// One batch submission per participant per minute is plenty — the batch is a
// single call, so this only guards against a client retry-storming the route.
const DEFAULT_RATE_LIMIT: RateLimiterOptions = { limit: 10, windowMs: 60_000 };

export type PredictionRoutesOptions = {
  rateLimit?: RateLimiterOptions;
};

type BatchRow = typeof predictionBatches.$inferSelect;
type PredictionRow = typeof predictions.$inferSelect;

function batchPayload(
  batch: BatchRow,
  rows: Pick<PredictionRow, "questionId" | "outcome">[],
) {
  return {
    id: batch.id,
    batchHash: batch.batchHash,
    chainStatus: batch.chainStatus,
    signature: batch.signature,
    submittedAt: batch.submittedAt,
    confirmedAt: batch.confirmedAt,
    predictions: rows.map((row) => ({
      questionId: row.questionId,
      outcome: row.outcome,
    })),
  };
}

/**
 * Batched prediction submission. The whole deck (both matches, same day)
 * commits at once: insert every prediction in one transaction, compute the
 * canonical batch hash server-side from what was inserted, create the
 * one-per-participant batch row, and submit that single hash on chain. A
 * duplicate request returns the existing batch — never a second batch, never
 * a changed answer. A chain failure leaves the batch pending with a
 * backed-off retry for the reconciler (src/predictions/reconciler.ts).
 */
export function createPredictionRoutes(
  getDb: DbProvider,
  auth: AuthAdapter,
  chain: ChainAdapter,
  options: PredictionRoutesOptions = {},
) {
  const app = new Hono<AuthEnvBindings>();
  const requireAuth = createAuthMiddleware(auth, getDb);
  const rateLimiter = createRateLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT);

  app.post("/predictions/batch", requireAuth, async (c) => {
    const body = postBatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json(
        {
          error:
            "body must be { answers: [{ questionId: uuid, outcome: yes|no|higher|lower }] }",
        },
        400,
      );
    }

    const answers = body.data.answers;
    const questionIds = answers.map((a) => a.questionId);
    if (new Set(questionIds).size !== questionIds.length) {
      return c.json({ error: "duplicate questionId in batch" }, 400);
    }

    const participant = c.get("participant");
    if (!rateLimiter.allow(participant.id)) {
      return c.json({ error: "too many submissions, slow down" }, 429);
    }
    if (!participant.walletAddress) {
      return c.json({ error: "a wallet is required before saving predictions" }, 400);
    }
    if (participant.delegationRevokedAt) {
      return c.json(
        { error: "delegation revoked: the server may not submit for this wallet" },
        403,
      );
    }

    const db = await getDb();

    // Load every referenced question + its fixture in one shot.
    const rows = await db
      .select({ question: questions, fixture: fixtures })
      .from(questions)
      .innerJoin(fixtures, eq(questions.fixtureId, fixtures.id))
      .where(inArray(questions.id, questionIds));
    const byId = new Map(rows.map((r) => [r.question.id, r]));

    for (const answer of answers) {
      const row = byId.get(answer.questionId);
      if (!row) {
        return c.json({ error: `question not found: ${answer.questionId}` }, 404);
      }
      const allowed = allowedOutcomes(row.question.template);
      if (!allowed || !allowed.includes(answer.outcome)) {
        return c.json(
          {
            error: `outcome ${answer.outcome} not allowed for question ${answer.questionId}`,
          },
          422,
        );
      }
    }

    // One global cutoff: 30 min before the earliest kickoff across the
    // batch's fixtures. All-or-nothing — a single answer past it rejects the
    // whole batch.
    const now = new Date();
    const earliestKickoff = Math.min(
      ...rows.map((r) => r.fixture.startsAt.getTime()),
    );
    if (now.getTime() >= earliestKickoff - LOCK_MARGIN_MS) {
      return c.json({ error: "predictions are locked for this batch" }, 409);
    }

    // A deck can span multiple fixtures (the cutoff above is the earliest
    // kickoff across them). Each fixture commits as its own batch — the
    // schema now keys uniqueness on (participant, fixture) — hashed over just
    // that fixture's answers. Resubmitting a fixture returns its existing
    // batch unchanged (immutable choice), never a second batch or chain call.
    const byFixture = new Map<string, typeof answers>();
    for (const answer of answers) {
      const fixtureId = byId.get(answer.questionId)!.fixture.id;
      const group = byFixture.get(fixtureId) ?? [];
      group.push(answer);
      byFixture.set(fixtureId, group);
    }

    const payloads: ReturnType<typeof batchPayload>[] = [];
    let anyCreated = false;

    for (const [fixtureId, group] of byFixture) {
      const [existing] = await db
        .select()
        .from(predictionBatches)
        .where(
          and(
            eq(predictionBatches.participantId, participant.id),
            eq(predictionBatches.fixtureId, fixtureId),
          ),
        );
      if (existing) {
        const rows2 = await db
          .select()
          .from(predictions)
          .where(eq(predictions.batchId, existing.id));
        payloads.push(batchPayload(existing, rows2));
        continue;
      }

      const batchHash = computeBatchHash(group);
      let batch: BatchRow;
      try {
        batch = await db.transaction(async (tx) => {
          const [created] = await tx
            .insert(predictionBatches)
            .values({ participantId: participant.id, fixtureId, batchHash })
            .returning();
          if (!created) throw new Error("batch insert failed");

          await tx.insert(predictions).values(
            group.map((answer) => ({
              participantId: participant.id,
              questionId: answer.questionId,
              outcome: answer.outcome,
              batchId: created.id,
            })),
          );
          return created;
        });
      } catch {
        // Lost the one-batch-per-(participant, fixture) race: return the winner.
        const [winner] = await db
          .select()
          .from(predictionBatches)
          .where(
            and(
              eq(predictionBatches.participantId, participant.id),
              eq(predictionBatches.fixtureId, fixtureId),
            ),
          );
        if (!winner) return c.json({ error: "batch submission failed" }, 500);
        const rows2 = await db
          .select()
          .from(predictions)
          .where(eq(predictions.batchId, winner.id));
        payloads.push(batchPayload(winner, rows2));
        continue;
      }

      anyCreated = true;
      await submitPendingBatch(db, chain, {
        batch,
        wallet: participant.walletAddress,
        now,
      });

      const [fresh] = await db
        .select()
        .from(predictionBatches)
        .where(eq(predictionBatches.id, batch.id));
      const inserted = await db
        .select()
        .from(predictions)
        .where(eq(predictions.batchId, batch.id));
      payloads.push(batchPayload(fresh ?? batch, inserted));
    }

    return c.json(payloads, anyCreated ? 201 : 200);
  });

  app.get("/predictions", requireAuth, async (c) => {
    const db = await getDb();
    const rows = await db
      .select({
        prediction: predictions,
        question: questions,
        fixture: fixtures,
        batch: predictionBatches,
      })
      .from(predictions)
      .innerJoin(questions, eq(predictions.questionId, questions.id))
      .innerJoin(fixtures, eq(questions.fixtureId, fixtures.id))
      .innerJoin(predictionBatches, eq(predictions.batchId, predictionBatches.id))
      .where(eq(predictions.participantId, c.get("participant").id))
      .orderBy(desc(predictions.createdAt));

    return c.json(
      rows.map((row) => {
        // The live screen needs the rendered copy, rule fields, and nested
        // fixture (stats/state) — not just the bare question row — so it can
        // display and evaluate a locked pick against the SSE stream.
        const copy = renderCopy(row.question, row.fixture);
        return {
          id: row.prediction.id,
          questionId: row.prediction.questionId,
          outcome: row.prediction.outcome,
          // Chain state lives on the parent batch now.
          chainStatus: row.batch.chainStatus,
          signature: row.batch.signature,
          submittedAt: row.batch.submittedAt,
          confirmedAt: row.batch.confirmedAt,
          question: {
            id: row.question.id,
            fixtureId: row.question.fixtureId,
            template: row.question.template,
            status: row.question.status,
            result: row.question.result,
            opensAt: row.question.opensAt,
            locksAt: row.question.locksAt,
            settledAt: row.question.settledAt,
            questionPda: row.question.questionPda,
            question: copy.text,
            outcomes: copy.outcomes,
            rule: {
              statKey1: row.question.statKey1,
              statKey2: row.question.statKey2,
              period: row.question.period,
              operator: row.question.operator,
              comparison: row.question.comparison,
              threshold: row.question.threshold,
              benchmarkValue: row.question.benchmarkValue,
            },
            fixture: {
              id: row.fixture.id,
              homeTeam: row.fixture.homeTeam,
              awayTeam: row.fixture.awayTeam,
              startsAt: row.fixture.startsAt,
              gameState: row.fixture.gameState,
              stats: row.fixture.stats,
            },
          },
          // Pure derivation, no stored column: unresolved/pushed questions
          // are neither right nor wrong.
          correct:
            row.question.result && row.question.result !== "push"
              ? row.prediction.outcome === row.question.result
              : null,
        };
      }),
    );
  });

  return app;
}
