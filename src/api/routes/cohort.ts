import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  agentCohorts,
  agentDecisions,
  agents,
  fixtures,
  participants,
  predictionBatches,
  predictions,
  questions,
} from "../../db/schema";
import type { ChainAdapter } from "../../chain";
import { computeBatchHash } from "../../predictions/hash";
import { submitPendingBatch } from "../../predictions/reconciler";
import { allowedOutcomes } from "../../questions/templates";
import type { Database } from "../../db/client";
import { renderCopy } from "./questions";
import type { DbProvider } from "../auth/middleware";

// Submissions stop 2 minutes before a question's lock (deadline-race guard,
// PRD non-negotiable 5). Applied to both the pending list and submit path.
const SUBMISSION_MARGIN_MS = 2 * 60_000;

// Short recent form the relay reasons over — no question text, just the shape
// of past calls (template + own pick + whether it landed).
const HISTORY_LIMIT = 10;

type CohortRow = typeof agentCohorts.$inferSelect;
type BatchRow = typeof predictionBatches.$inferSelect;

type CohortEnvBindings = { Variables: { cohort: CohortRow } };

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token, ...rest] = header.split(" ");
  if (scheme !== "Bearer" || !token || rest.length > 0) return null;
  return token;
}

/**
 * Authenticates the Hermes relay by its cohort bearer token. The plaintext is
 * hashed and matched against `agent_cohorts.token_hash` — the token and its
 * hash are never logged. A missing or unknown token is 401; a known cohort
 * that is paused or revoked is 403.
 */
function createCohortAuth(getDb: DbProvider): MiddlewareHandler<CohortEnvBindings> {
  return async (c, next) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (!token) return c.json({ error: "unauthorized" }, 401);

    const db = await getDb();
    const [cohort] = await db
      .select()
      .from(agentCohorts)
      .where(eq(agentCohorts.tokenHash, sha256Hex(token)));

    if (!cohort) return c.json({ error: "unauthorized" }, 401);
    if (cohort.status !== "active") {
      return c.json({ error: "cohort is not active" }, 403);
    }

    c.set("cohort", cohort);
    await next();
  };
}

const decisionItemSchema = z.strictObject({
  agent_key: z.string().min(1).max(32),
  question_id: z.uuid(),
  outcome: z.string().min(1).max(16),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(280),
});

type DecisionItem = z.infer<typeof decisionItemSchema>;

/** Maps a per-item schema failure to a stable, non-leaky error code. */
function itemErrorCode(error: z.ZodError): string {
  const path = error.issues[0]?.path[0];
  if (path === "confidence") return "invalid_confidence";
  if (path === "rationale") return "invalid_rationale";
  if (path === "outcome") return "invalid_outcome";
  if (path === "question_id") return "invalid_question_id";
  if (path === "agent_key") return "invalid_agent_key";
  return "invalid_item";
}

type ItemResult =
  | { agent_key: unknown; question_id: unknown; ok: true; predictionId: string }
  | { agent_key: unknown; question_id: unknown; ok: false; error: string };

/**
 * The MCP boundary for the AI player cohort. Two bearer-authenticated
 * endpoints let an external Hermes relay read pending work and submit
 * decisions on behalf of the cohort's agents. Identity is backend-decided:
 * the token authorizes the relay, and the `agent_key` -> agent -> participant
 * binding decides whose prediction lands. A forged or cross-cohort key is
 * rejected; raw model output is never stored (strict schema validation);
 * duplicates are idempotent.
 */
export function createCohortRoutes(getDb: DbProvider, chain: ChainAdapter) {
  const app = new Hono<CohortEnvBindings>();
  const requireCohort = createCohortAuth(getDb);

  // get_pending_work: the cohort's active players, their short recent form,
  // and the open questions each still has to answer.
  app.post("/cohort/pending", requireCohort, async (c) => {
    const cohort = c.get("cohort");
    const db = await getDb();

    const players = await db
      .select({ agent: agents, participant: participants })
      .from(agents)
      .innerJoin(participants, eq(agents.participantId, participants.id))
      .where(and(eq(agents.cohortId, cohort.id), eq(agents.status, "active")));

    if (players.length === 0) return c.json({ players: [] });

    const participantIds = players.map((p) => p.participant.id);

    // Last ~10 settled picks per player: template + own outcome + result are
    // cheaply joinable off the predictions row; the question text is not sent.
    const settled = await db
      .select({
        participantId: predictions.participantId,
        template: questions.template,
        outcome: predictions.outcome,
        result: questions.result,
        createdAt: predictions.createdAt,
      })
      .from(predictions)
      .innerJoin(questions, eq(predictions.questionId, questions.id))
      .where(
        and(
          inArray(predictions.participantId, participantIds),
          eq(questions.status, "settled"),
        ),
      )
      .orderBy(desc(predictions.createdAt));

    const historyByParticipant = new Map<
      string,
      { template: string; outcome: string; correct: boolean | null }[]
    >();
    for (const row of settled) {
      const list = historyByParticipant.get(row.participantId) ?? [];
      if (list.length >= HISTORY_LIMIT) continue;
      list.push({
        template: row.template,
        outcome: row.outcome,
        // Unresolved/pushed questions are neither right nor wrong.
        correct:
          row.result && row.result !== "push"
            ? row.outcome === row.result
            : null,
      });
      historyByParticipant.set(row.participantId, list);
    }

    // Which questions each player has already answered — excluded from the
    // open list so the relay never re-picks (and can't create a duplicate).
    const answered = await db
      .select({
        participantId: predictions.participantId,
        questionId: predictions.questionId,
      })
      .from(predictions)
      .where(inArray(predictions.participantId, participantIds));

    const answeredByParticipant = new Map<string, Set<string>>();
    for (const row of answered) {
      const set = answeredByParticipant.get(row.participantId) ?? new Set();
      set.add(row.questionId);
      answeredByParticipant.set(row.participantId, set);
    }

    // Open questions with more than the 2-minute margin left before lock.
    const cutoff = new Date(Date.now() + SUBMISSION_MARGIN_MS);
    const openRows = await db
      .select({ question: questions, fixture: fixtures })
      .from(questions)
      .innerJoin(fixtures, eq(questions.fixtureId, fixtures.id))
      .where(and(eq(questions.status, "open"), gt(questions.locksAt, cutoff)));

    const openQuestions = openRows.map((row) => {
      const copy = renderCopy(row.question, row.fixture);
      return {
        id: row.question.id,
        question: copy.text,
        outcomes: copy.outcomes,
        locks_at: row.question.locksAt,
      };
    });

    return c.json({
      players: players.map((p) => {
        const answeredSet = answeredByParticipant.get(p.participant.id);
        return {
          agent_key: p.agent.agentKey,
          persona: p.agent.persona,
          strategy: p.agent.strategy,
          history: historyByParticipant.get(p.participant.id) ?? [],
          open_questions: openQuestions.filter((q) => !answeredSet?.has(q.id)),
        };
      }),
    });
  });

  // submit_decisions: per-item independent validation and storage. One bad
  // item never sinks the others; a duplicate returns the existing prediction.
  app.post("/cohort/decisions", requireCohort, async (c) => {
    const cohort = c.get("cohort");
    const body = await c.req.json().catch(() => null);
    if (!Array.isArray(body)) {
      return c.json({ error: "body must be an array of decisions" }, 400);
    }

    const db = await getDb();

    // Active agents of THIS cohort only — the map is the identity gate. A key
    // that isn't here (forged, cross-cohort, paused, or revoked) is rejected.
    const cohortAgents = await db
      .select({
        agentKey: agents.agentKey,
        participantId: agents.participantId,
      })
      .from(agents)
      .where(and(eq(agents.cohortId, cohort.id), eq(agents.status, "active")));
    const participantByKey = new Map(
      cohortAgents.map((a) => [a.agentKey, a.participantId]),
    );

    const parsedItems = body.map((item) => {
      const parsed = decisionItemSchema.safeParse(item);
      return parsed.success ? parsed.data : null;
    });

    // Prefetch every referenced question once.
    const questionIds = Array.from(
      new Set(parsedItems.flatMap((item) => (item ? [item.question_id] : []))),
    );
    const questionRows = questionIds.length
      ? await db
          .select()
          .from(questions)
          .where(inArray(questions.id, questionIds))
      : [];
    const questionById = new Map(questionRows.map((q) => [q.id, q]));

    const now = new Date();
    const lockCutoff = new Date(now.getTime() + SUBMISSION_MARGIN_MS);
    const results: ItemResult[] = [];
    const affected = new Set<string>();

    for (let i = 0; i < body.length; i++) {
      const raw = (body[i] ?? null) as Record<string, unknown> | null;
      const echo = {
        agent_key: raw?.agent_key,
        question_id: raw?.question_id,
      };

      const parsed = parsedItems[i];
      if (!parsed) {
        const reparsed = decisionItemSchema.safeParse(raw);
        results.push({
          ...echo,
          ok: false,
          error: reparsed.success
            ? "invalid_item"
            : itemErrorCode(reparsed.error),
        });
        continue;
      }

      const participantId = participantByKey.get(parsed.agent_key);
      if (!participantId) {
        results.push({ ...echo, ok: false, error: "unknown_agent" });
        continue;
      }

      const question = questionById.get(parsed.question_id);
      if (!question) {
        results.push({ ...echo, ok: false, error: "question_not_found" });
        continue;
      }
      if (question.status !== "open") {
        results.push({ ...echo, ok: false, error: "question_not_open" });
        continue;
      }
      if (question.locksAt <= lockCutoff) {
        results.push({ ...echo, ok: false, error: "locked" });
        continue;
      }

      const allowed = allowedOutcomes(question.template);
      if (!allowed || !allowed.includes(parsed.outcome)) {
        results.push({ ...echo, ok: false, error: "invalid_outcome" });
        continue;
      }

      // Idempotency: an existing prediction for (participant, question) is
      // returned unchanged, never a second row.
      const [existing] = await db
        .select({ id: predictions.id })
        .from(predictions)
        .where(
          and(
            eq(predictions.participantId, participantId),
            eq(predictions.questionId, parsed.question_id),
          ),
        );
      if (existing) {
        results.push({ ...echo, ok: true, predictionId: existing.id });
        continue;
      }

      const predictionId = await insertDecision(db, {
        participantId,
        item: parsed,
      });
      affected.add(participantId);
      results.push({ ...echo, ok: true, predictionId });
    }

    // Flow accepted predictions into the same chain-commitment machinery
    // humans use — but only while the batch is still pending (the on-chain
    // batch hash is immutable once confirmed; see the batch-semantics note at
    // the foot of this file).
    for (const participantId of affected) {
      await commitBatch(db, chain, participantId, now);
    }

    return c.json({ results });
  });

  return app;
}

/**
 * Inserts one agent decision and its immutable prediction, attached to the
 * participant's single prediction batch (created lazily). The decision row is
 * idempotent on its natural key; the prediction is guaranteed new by the
 * caller's duplicate check.
 */
async function insertDecision(
  db: Database,
  input: { participantId: string; item: DecisionItem },
): Promise<string> {
  const { participantId, item } = input;
  const batch = await ensureBatch(db, participantId);

  const [prediction] = await db
    .insert(predictions)
    .values({
      participantId,
      questionId: item.question_id,
      outcome: item.outcome as (typeof predictions.$inferInsert)["outcome"],
      batchId: batch.id,
    })
    .returning({ id: predictions.id });

  await db
    .insert(agentDecisions)
    .values({
      participantId,
      questionId: item.question_id,
      outcome: item.outcome,
      confidence: item.confidence.toString(),
      rationale: item.rationale,
    })
    .onConflictDoNothing();

  if (!prediction) throw new Error("prediction insert failed");
  return prediction.id;
}

/**
 * One prediction batch per participant (the schema's unique constraint). An
 * agent's decisions arrive across ticks, so the batch is created on the first
 * decision and extended in place afterward.
 */
async function ensureBatch(
  db: Database,
  participantId: string,
): Promise<BatchRow> {
  const [existing] = await db
    .select()
    .from(predictionBatches)
    .where(eq(predictionBatches.participantId, participantId));
  if (existing) return existing;

  try {
    const [created] = await db
      .insert(predictionBatches)
      .values({ participantId, batchHash: computeBatchHash([]) })
      .returning();
    if (created) return created;
  } catch {
    // Lost the one-batch-per-participant race: fall through to the winner.
  }
  const [winner] = await db
    .select()
    .from(predictionBatches)
    .where(eq(predictionBatches.participantId, participantId));
  if (!winner) throw new Error("batch upsert failed");
  return winner;
}

/**
 * Recomputes the participant's batch hash over every prediction now attached
 * and submits it on chain — but only while the batch is still pending. Once
 * the batch is confirmed on chain its hash is frozen (the batch PDA is
 * immutable), so later-tick predictions are stored and attributed but not
 * re-committed. Reuses the human submit path (submitPendingBatch).
 */
async function commitBatch(
  db: Database,
  chain: ChainAdapter,
  participantId: string,
  now: Date,
): Promise<void> {
  const [batch] = await db
    .select()
    .from(predictionBatches)
    .where(eq(predictionBatches.participantId, participantId));
  if (!batch || batch.chainStatus !== "pending") return;

  const rows = await db
    .select({ questionId: predictions.questionId, outcome: predictions.outcome })
    .from(predictions)
    .where(eq(predictions.batchId, batch.id));
  const batchHash = computeBatchHash(rows);

  await db
    .update(predictionBatches)
    .set({ batchHash })
    .where(eq(predictionBatches.id, batch.id));

  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.id, participantId));

  // No wallet yet (or delegation revoked) → leave the batch pending for the
  // reconciler, exactly as the human path does.
  if (!participant?.walletAddress || participant.delegationRevokedAt) return;

  await submitPendingBatch(db, chain, {
    batch: { ...batch, batchHash },
    wallet: participant.walletAddress,
    now,
  });
}
