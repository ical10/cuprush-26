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
import { computeBatchHash } from "../../predictions/hash";
import { allowedOutcomes } from "../../questions/templates";
import type { Database } from "../../db/client";
import { renderCopy } from "./questions";
import type { DbProvider } from "../auth/middleware";

// Submissions stop 2 minutes before a question's lock (deadline-race guard,
// PRD non-negotiable 5). Applied to both the pending list and submit path.
const SUBMISSION_MARGIN_MS = 2 * 60_000;
// Page size per player per tick: keeps the pending payload bounded when a
// large backlog opens at once (a full board briefly hit ~209KB for the whole
// cohort). Soonest-locking questions come first; the 3-minute tick cadence
// drains any backlog long before decks lock.
const PENDING_QUESTIONS_LIMIT = Number(process.env.COHORT_PENDING_LIMIT ?? 20);

// Short recent form the relay reasons over — no question text, just the shape
// of past calls (template + own pick + whether it landed).
const HISTORY_LIMIT = 10;

export type CohortRow = typeof agentCohorts.$inferSelect;
type BatchRow = typeof predictionBatches.$inferSelect;

type CohortEnvBindings = { Variables: { cohort: CohortRow } };

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Parses a `Bearer <token>` Authorization header, or null if malformed. */
export function cohortBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token, ...rest] = header.split(" ");
  if (scheme !== "Bearer" || !token || rest.length > 0) return null;
  return token;
}

export type CohortAuthResult =
  | { ok: true; cohort: CohortRow }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Authenticates the Hermes relay by its cohort bearer token — the single auth
 * decision shared by the REST middleware and the MCP transport. The plaintext
 * is hashed and matched against `agent_cohorts.token_hash`; the token and its
 * hash are never logged. A missing or unknown token is 401; a known cohort
 * that is paused or revoked is 403.
 */
export async function authenticateCohort(
  db: Database,
  token: string | null,
): Promise<CohortAuthResult> {
  if (!token) return { ok: false, status: 401, error: "unauthorized" };

  const [cohort] = await db
    .select()
    .from(agentCohorts)
    .where(eq(agentCohorts.tokenHash, sha256Hex(token)));

  if (!cohort) return { ok: false, status: 401, error: "unauthorized" };
  if (cohort.status !== "active") {
    return { ok: false, status: 403, error: "cohort is not active" };
  }
  return { ok: true, cohort };
}

function createCohortAuth(getDb: DbProvider): MiddlewareHandler<CohortEnvBindings> {
  return async (c, next) => {
    const db = await getDb();
    const result = await authenticateCohort(
      db,
      cohortBearerToken(c.req.header("Authorization")),
    );
    if (!result.ok) return c.json({ error: result.error }, result.status);
    c.set("cohort", result.cohort);
    await next();
  };
}

export const decisionItemSchema = z.strictObject({
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

export type PendingPlayer = {
  agent_key: string;
  persona: string;
  strategy: string;
  history: { template: string; outcome: string; correct: boolean | null }[];
  open_questions: {
    id: string;
    question: string;
    outcomes: readonly string[];
    locks_at: Date;
  }[];
};

/**
 * The MCP boundary for the AI player cohort. Two bearer-authenticated
 * endpoints let an external Hermes relay read pending work and submit
 * decisions on behalf of the cohort's agents. Identity is backend-decided:
 * the token authorizes the relay, and the `agent_key` -> agent -> participant
 * binding decides whose prediction lands. A forged or cross-cohort key is
 * rejected; raw model output is never stored (strict schema validation);
 * duplicates are idempotent.
 */
export function createCohortRoutes(getDb: DbProvider) {
  const app = new Hono<CohortEnvBindings>();
  const requireCohort = createCohortAuth(getDb);

  // get_pending_work: the cohort's active players, their short recent form,
  // and the open questions each still has to answer.
  app.post("/cohort/pending", requireCohort, async (c) => {
    return c.json(await getPendingWork(await getDb(), c.get("cohort")));
  });

  // submit_decisions: per-item independent validation and storage. One bad
  // item never sinks the others; a duplicate returns the existing prediction.
  app.post("/cohort/decisions", requireCohort, async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!Array.isArray(body)) {
      return c.json({ error: "body must be an array of decisions" }, 400);
    }
    return c.json(await submitDecisions(await getDb(), c.get("cohort"), body));
  });

  return app;
}

/**
 * The read side of the cohort boundary, callable without an HTTP context so
 * both the REST endpoint and the MCP `get_pending_work` tool share it. Returns
 * the cohort's active players, their short recent form, and the open questions
 * each still has to answer.
 */
export async function getPendingWork(
  db: Database,
  cohort: CohortRow,
): Promise<{ players: PendingPlayer[] }> {
  {
    const players = await db
      .select({ agent: agents, participant: participants })
      .from(agents)
      .innerJoin(participants, eq(agents.participantId, participants.id))
      .where(and(eq(agents.cohortId, cohort.id), eq(agents.status, "active")));

    if (players.length === 0) return { players: [] };

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

    // Open questions with more than the 2-minute margin left before lock,
    // soonest lock first so a capped page never starves an expiring deck.
    const cutoff = new Date(Date.now() + SUBMISSION_MARGIN_MS);
    const openRows = await db
      .select({ question: questions, fixture: fixtures })
      .from(questions)
      .innerJoin(fixtures, eq(questions.fixtureId, fixtures.id))
      .where(and(eq(questions.status, "open"), gt(questions.locksAt, cutoff)))
      .orderBy(questions.locksAt);

    const openQuestions = openRows.map((row) => {
      const copy = renderCopy(row.question, row.fixture);
      return {
        id: row.question.id,
        question: copy.text,
        outcomes: copy.outcomes,
        locks_at: row.question.locksAt,
      };
    });

    return {
      players: players.map((p) => {
        const answeredSet = answeredByParticipant.get(p.participant.id);
        return {
          agent_key: p.agent.agentKey,
          persona: p.agent.persona,
          strategy: p.agent.strategy,
          history: historyByParticipant.get(p.participant.id) ?? [],
          open_questions: openQuestions
            .filter((q) => !answeredSet?.has(q.id))
            .slice(0, PENDING_QUESTIONS_LIMIT),
        };
      }),
    };
  }
}

/**
 * The write side of the cohort boundary, callable without an HTTP context so
 * both the REST endpoint and the MCP `submit_decisions` tool share it. Each
 * item is validated and stored independently: one bad item never sinks the
 * others, a duplicate returns the existing prediction, and `agent_key` is
 * bound to a participant server-side (a forged or cross-cohort key is
 * rejected). `body` is any array; every element is validated per-item.
 */
export async function submitDecisions(
  db: Database,
  cohort: CohortRow,
  body: unknown[],
): Promise<{ results: ItemResult[] }> {
  {
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
        fixtureId: question.fixtureId,
        item: parsed,
      });
      affected.add(participantId);
      results.push({ ...echo, ok: true, predictionId });
    }

    // Keep each touched fixture's stored batch hash current with the picks now
    // attached. Nothing is submitted on chain here — the reconciler is the
    // single commit path and freezes each hash on chain when its fixture locks
    // (see the batch-semantics note at the foot of this file).
    for (const participantId of affected) {
      await refreshBatchHashes(db, participantId);
    }

    return { results };
  }
}

/**
 * Inserts one agent decision and its immutable prediction, attached to the
 * participant's single prediction batch (created lazily). The decision row is
 * idempotent on its natural key; the prediction is guaranteed new by the
 * caller's duplicate check.
 */
async function insertDecision(
  db: Database,
  input: { participantId: string; fixtureId: string; item: DecisionItem },
): Promise<string> {
  const { participantId, fixtureId, item } = input;
  const batch = await ensureBatch(db, participantId, fixtureId);

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
 * One prediction batch per participant per fixture (the schema's unique
 * constraint). An agent's decisions arrive across ticks and can span several
 * fixtures, so a batch is created lazily per fixture on the first decision for
 * it and extended in place afterward.
 */
async function ensureBatch(
  db: Database,
  participantId: string,
  fixtureId: string,
): Promise<BatchRow> {
  const [existing] = await db
    .select()
    .from(predictionBatches)
    .where(
      and(
        eq(predictionBatches.participantId, participantId),
        eq(predictionBatches.fixtureId, fixtureId),
      ),
    );
  if (existing) return existing;

  try {
    const [created] = await db
      .insert(predictionBatches)
      .values({ participantId, fixtureId, batchHash: computeBatchHash([]) })
      .returning();
    if (created) return created;
  } catch {
    // Lost the one-batch-per-(participant, fixture) race: fall through.
  }
  const [winner] = await db
    .select()
    .from(predictionBatches)
    .where(
      and(
        eq(predictionBatches.participantId, participantId),
        eq(predictionBatches.fixtureId, fixtureId),
      ),
    );
  if (!winner) throw new Error("batch upsert failed");
  return winner;
}

/**
 * Recomputes each of the participant's still-pending batch hashes over the
 * predictions now attached, keeping the stored hash current as decisions
 * arrive across ticks. A participant can hold one batch per fixture; each is
 * hashed independently. Once a batch is confirmed on chain its hash is frozen
 * (the batch PDA is immutable), so a confirmed batch is left untouched. No
 * chain submission happens here — the reconciler commits each fixture's hash
 * when that fixture locks.
 */
async function refreshBatchHashes(
  db: Database,
  participantId: string,
): Promise<void> {
  const batches = await db
    .select()
    .from(predictionBatches)
    .where(eq(predictionBatches.participantId, participantId));

  for (const batch of batches) {
    if (batch.chainStatus !== "pending") continue;

    const rows = await db
      .select({ questionId: predictions.questionId, outcome: predictions.outcome })
      .from(predictions)
      .where(eq(predictions.batchId, batch.id));
    const batchHash = computeBatchHash(rows);

    await db
      .update(predictionBatches)
      .set({ batchHash })
      .where(eq(predictionBatches.id, batch.id));
  }
}
