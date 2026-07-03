import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { predictions, questions } from "../../db/schema";
import type { ChainAdapter } from "../../chain";
import {
  createRateLimiter,
  type RateLimiterOptions,
} from "../../chain/guardrails";
import { allowedOutcomes } from "../../questions/templates";
import { submitPendingPrediction } from "../../predictions/reconciler";
import type { AuthAdapter } from "../auth/adapter";
import {
  createAuthMiddleware,
  type AuthEnvBindings,
  type DbProvider,
} from "../auth/middleware";

export const postPredictionSchema = z.strictObject({
  questionId: z.uuid(),
  outcome: z.enum(["yes", "no", "higher", "lower"]),
});

// Sponsorship guardrail: a participant may not spam sponsored submissions.
// The per-wallet-per-question cap is already structural (unique
// (participant_id, question_id) + PDA seeds allow exactly one), so the only
// runtime cap needed is submissions per participant per minute.
const DEFAULT_RATE_LIMIT: RateLimiterOptions = { limit: 10, windowMs: 60_000 };

export type PredictionRoutesOptions = {
  rateLimit?: RateLimiterOptions;
};

type PredictionRow = typeof predictions.$inferSelect;

function predictionPayload(row: PredictionRow) {
  return {
    id: row.id,
    questionId: row.questionId,
    outcome: row.outcome,
    chainStatus: row.chainStatus,
    predictionPda: row.predictionPda,
    signature: row.signature,
    submittedAt: row.submittedAt,
    confirmedAt: row.confirmedAt,
  };
}

/**
 * Prediction submission API (research doc "Prediction submission"):
 * insert a pending row on the unique (participant_id, question_id)
 * constraint, submit through the chain adapter, mark confirmed with the
 * signature. A duplicate request returns the existing row — never a second
 * transaction, never a changed answer. A chain failure leaves the row
 * pending with a backed-off retry for the reconciler
 * (src/predictions/reconciler.ts).
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

  app.post("/predictions", requireAuth, async (c) => {
    const body = postPredictionSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!body.success) {
      return c.json(
        { error: "body must be { questionId: uuid, outcome: yes|no|higher|lower }" },
        400,
      );
    }

    const participant = c.get("participant");
    if (!rateLimiter.allow(participant.id)) {
      return c.json({ error: "too many submissions, slow down" }, 429);
    }

    const db = await getDb();
    const [question] = await db
      .select()
      .from(questions)
      .where(eq(questions.id, body.data.questionId));
    if (!question) {
      return c.json({ error: "question not found" }, 404);
    }

    const allowed = allowedOutcomes(question.template);
    if (!allowed || !allowed.includes(body.data.outcome)) {
      return c.json(
        { error: `outcome must be one of: ${(allowed ?? []).join(", ")}` },
        422,
      );
    }

    // Not-open is checked here from Postgres and again on-chain by the
    // program (and its stub): status plus the actual opens_at/locks_at
    // window, so a lagging scheduler tick can never extend the window.
    const now = new Date();
    const inWindow =
      now.getTime() >= question.opensAt.getTime() &&
      now.getTime() < question.locksAt.getTime();
    if (question.status !== "open" || !inWindow) {
      return c.json({ error: "question is not open for predictions" }, 409);
    }

    if (!participant.walletAddress) {
      return c.json(
        { error: "a wallet is required before saving a prediction" },
        400,
      );
    }
    if (participant.delegationRevokedAt) {
      return c.json(
        { error: "delegation revoked: the server may not submit for this wallet" },
        403,
      );
    }

    // Idempotent insert: the unique (participant_id, question_id)
    // constraint decides who owns the row. A duplicate request gets the
    // existing prediction back unchanged, whatever outcome it sent.
    const [inserted] = await db
      .insert(predictions)
      .values({
        participantId: participant.id,
        questionId: question.id,
        outcome: body.data.outcome,
      })
      .onConflictDoNothing({
        target: [predictions.participantId, predictions.questionId],
      })
      .returning();

    if (!inserted) {
      const [existing] = await db
        .select()
        .from(predictions)
        .where(
          and(
            eq(predictions.participantId, participant.id),
            eq(predictions.questionId, question.id),
          ),
        );
      if (!existing) return c.json({ error: "prediction not found" }, 500);
      return c.json(predictionPayload(existing), 200);
    }

    await submitPendingPrediction(db, chain, {
      prediction: inserted,
      question,
      wallet: participant.walletAddress,
      now,
    });

    const [fresh] = await db
      .select()
      .from(predictions)
      .where(eq(predictions.id, inserted.id));
    return c.json(predictionPayload(fresh ?? inserted), 201);
  });

  app.get("/predictions", requireAuth, async (c) => {
    const db = await getDb();
    const rows = await db
      .select({
        prediction: predictions,
        question: {
          id: questions.id,
          fixtureId: questions.fixtureId,
          template: questions.template,
          status: questions.status,
          result: questions.result,
          opensAt: questions.opensAt,
          locksAt: questions.locksAt,
          questionPda: questions.questionPda,
        },
      })
      .from(predictions)
      .innerJoin(questions, eq(predictions.questionId, questions.id))
      .where(eq(predictions.participantId, c.get("participant").id))
      .orderBy(desc(predictions.createdAt));

    return c.json(
      rows.map((row) => ({
        ...predictionPayload(row.prediction),
        question: row.question,
      })),
    );
  });

  return app;
}
