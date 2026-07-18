import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { createStubChainAdapter } from "../chain";
import { AGENT_SEEDS, COHORT_NAME, seedAgents } from "../db/seed-agents";
import { provisionAgents, type WalletCreator } from "../agents/provision";
import { generateQuestionsForFixture } from "../questions/generate";
import { createSettlementExecutor } from "../questions/settle";
import { createApp } from "./app";
import { createDevAuthAdapter } from "./auth/dev";

/**
 * Wave-3 integration proof (hermes-cohort-prd.md build order step 3): one
 * simulated full tick end to end against a local DB, driving the *real* merged
 * pieces — seed path, provisioning boundary, cohort API, settlement executor,
 * and leaderboard filters — rather than reaching past them. The suite is one
 * flowing scenario: state built by each step is consumed by the next.
 */

const {
  agentDecisions,
  agents,
  fixtures,
  participants,
  predictionBatches,
  predictions,
  questions,
  users,
} = schema;

const sql = postgres(testDatabaseUrl(), { max: 10 });
const db = drizzle(sql, { schema });

const chain = createStubChainAdapter();
let app: ReturnType<typeof createApp>;

// The whole scenario shares one clean database so the global leaderboard and
// settlement scans see only this tick's rows. Integration files run serially
// (vitest.config fileParallelism:false), so a start-of-file truncate is safe.
async function truncateAll() {
  await sql`TRUNCATE agent_decisions, agents, agent_cohorts, predictions, prediction_batches, users, questions, fixtures, participants RESTART IDENTITY CASCADE`;
}

beforeAll(async () => {
  await truncateAll();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  app = createApp({ db, auth: createDevAuthAdapter({}), chain });
  warn.mockRestore();
});

afterAll(async () => {
  await truncateAll();
  await sql.end();
});

function cohortAuth(token: string, body?: unknown) {
  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

function pending(token: string) {
  return app.request("/api/cohort/pending", cohortAuth(token, {}));
}

function submit(token: string, decisions: unknown) {
  return app.request("/api/cohort/decisions", cohortAuth(token, decisions));
}

// Mocked Privy wallet boundary (mirrors provision.int.test.ts): deterministic
// wallet id + address per agent, no live credentials.
function recordingCreator(): { creator: WalletCreator; keys: string[] } {
  const keys: string[] = [];
  const creator: WalletCreator = async ({ agentKey, idempotencyKey }) => {
    keys.push(idempotencyKey);
    return { walletId: `wid-${agentKey}`, address: `wallet-${agentKey}` };
  };
  return { creator, keys };
}

type PendingBody = {
  players: {
    agent_key: string;
    persona: string;
    strategy: string;
    history: { template: string; outcome: string; correct: boolean | null }[];
    open_questions: { id: string; question: string; outcomes: string[]; locks_at: string }[];
  }[];
};

type SubmitBody = {
  results: { ok: boolean; error?: string; predictionId?: string; agent_key: unknown }[];
};

type LeaderboardRow = {
  displayName: string | null;
  points: number;
  currentStreak: number;
  bestStreak: number;
  kind: "human" | "agent";
  cohortName: string | null;
};

// The winner settles deterministically from the seeded stats (home 2, away 1),
// though which side the template compares first is its own concern — so the
// scenario reads the actual result back and derives correctness from it.
// Agents get a deterministic outcome by sorted index: even -> yes, odd -> no.
// Exactly five pick each, so exactly five land whatever the result is.
function outcomeForIndex(index: number): "yes" | "no" {
  return index % 2 === 0 ? "yes" : "no";
}

// --- scenario state, threaded across the steps ------------------------------

let cohortToken: string;
let cohortId: string;
/** The ten active agents, sorted by agent_key for a stable deterministic index. */
let cohort: { agentKey: string; participantId: string; walletAddress: string }[] = [];
let fixtureId: string;
let winnerQuestionId: string;
let generatedQuestionIds: string[] = [];
let openSecondaryId: string;
let batch1AgentKeys: string[] = [];
let batch1PredictionIds: string[] = [];

describe("cohort full-tick integration", () => {
  it("step 1 — seeds a user, seeds the cohort, and provisions ten active agents with wallets", async () => {
    // A real cohort owner: the seed refuses to fabricate one.
    const [ownerParticipant] = await db
      .insert(participants)
      .values({ kind: "human", displayName: "Owner" })
      .returning();
    await db
      .insert(users)
      .values({ participantId: ownerParticipant!.id, privyUserId: `did:privy:${randomUUID()}` });

    // Real seed path: ten fixed agent identities, no secrets.
    const seedSummary = await seedAgents(db);
    expect(seedSummary.agentsCreated).toBe(AGENT_SEEDS.length);
    cohortId = seedSummary.cohortId;

    // Real provisioning path through the mocked wallet boundary: creates
    // wallets, activates agents, and mints the cohort token (printed once).
    const { creator, keys } = recordingCreator();
    const logLines: string[] = [];
    const provisionSummary = await provisionAgents({
      db,
      createWallet: creator,
      env: { NODE_ENV: "test" },
      log: (m) => logLines.push(m),
    });
    expect(provisionSummary.walletsCreated).toBe(AGENT_SEEDS.length);
    expect(provisionSummary.activated).toBe(AGENT_SEEDS.length);
    expect(provisionSummary.tokenIssued).toBe(true);
    expect(keys).toHaveLength(AGENT_SEEDS.length);

    // Recover the one-time plaintext token from the printed banner.
    const tokenLine = logLines.find((line) => line.trimStart().startsWith("token:"));
    expect(tokenLine).toBeDefined();
    cohortToken = tokenLine!.replace(/^\s*token:\s*/, "").trim();
    expect(cohortToken.length).toBeGreaterThan(0);

    const rows = await db
      .select({
        agentKey: agents.agentKey,
        participantId: agents.participantId,
        status: agents.status,
        walletAddress: participants.walletAddress,
      })
      .from(agents)
      .innerJoin(participants, eq(agents.participantId, participants.id))
      .where(eq(agents.cohortId, cohortId));

    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.status === "active")).toBe(true);
    expect(rows.every((r) => r.walletAddress !== null)).toBe(true);

    cohort = rows
      .map((r) => ({
        agentKey: r.agentKey,
        participantId: r.participantId,
        walletAddress: r.walletAddress!,
      }))
      .sort((a, b) => a.agentKey.localeCompare(b.agentKey));

    // Token authenticates against the active cohort.
    const res = await pending(cohortToken);
    expect(res.status).toBe(200);
  });

  it("step 2 — pending returns ten players, each carrying the generated open questions", async () => {
    // Real generation path for one fixture; clean DB -> winner + always-available
    // secondaries. Generated questions land "scheduled"; the scheduler would
    // open them, so flip them to open for the tick.
    const now = Date.now();
    fixtureId = `fx-${randomUUID().slice(0, 18)}`;
    await db.insert(fixtures).values({
      id: fixtureId,
      homeTeam: "Argentina",
      awayTeam: "France",
      startsAt: new Date(now + 3 * 60 * 60_000),
      stage: "group",
    });

    const generated = await generateQuestionsForFixture(db, fixtureId);
    expect(generated.inserted.length).toBeGreaterThan(1);

    await db
      .update(questions)
      .set({ status: "open" })
      .where(eq(questions.fixtureId, fixtureId));

    generatedQuestionIds = generated.inserted.map((q) => q.id).sort();
    const winner = generated.inserted.find((q) => q.template === "winner");
    expect(winner).toBeDefined();
    winnerQuestionId = winner!.id;
    openSecondaryId = generated.inserted.find((q) => q.template !== "winner")!.id;

    const res = await pending(cohortToken);
    expect(res.status).toBe(200);
    const body: PendingBody = await res.json();

    expect(body.players).toHaveLength(10);
    for (const agent of cohort) {
      const player = body.players.find((p) => p.agent_key === agent.agentKey);
      expect(player, `player ${agent.agentKey} present`).toBeDefined();
      expect(typeof player!.persona).toBe("string");
      expect(typeof player!.strategy).toBe("string");
      // No history yet — first tick.
      expect(player!.history).toEqual([]);
      // Each player sees every generated open question.
      const openIds = player!.open_questions.map((q) => q.id).sort();
      expect(openIds).toEqual(generatedQuestionIds);
      const winnerCard = player!.open_questions.find((q) => q.id === winnerQuestionId)!;
      expect(winnerCard.question).toContain("Argentina");
      expect(winnerCard.outcomes).toEqual(["yes", "no"]);
    }
  });

  it("step 3 — decisions submit across two batches, each attributed to the right participant", async () => {
    const decisionFor = (index: number, agentKey: string) => ({
      agent_key: agentKey,
      question_id: winnerQuestionId,
      outcome: outcomeForIndex(index),
      confidence: 0.5 + index / 100,
      rationale: `deterministic pick for ${agentKey}`,
    });

    // Two requests (5 + 5) prove a multi-request tick accumulates correctly.
    const firstFive = cohort.slice(0, 5);
    const lastFive = cohort.slice(5);
    batch1AgentKeys = firstFive.map((a) => a.agentKey);

    const res1 = await submit(
      cohortToken,
      firstFive.map((a, i) => decisionFor(i, a.agentKey)),
    );
    expect(res1.status).toBe(200);
    const body1: SubmitBody = await res1.json();
    expect(body1.results.every((r) => r.ok)).toBe(true);
    batch1PredictionIds = body1.results.map((r) => r.predictionId!);

    const res2 = await submit(
      cohortToken,
      lastFive.map((a, i) => decisionFor(i + 5, a.agentKey)),
    );
    expect(res2.status).toBe(200);
    const body2: SubmitBody = await res2.json();
    expect(body2.results.every((r) => r.ok)).toBe(true);

    // Every participant now owns exactly one prediction + one decision on the
    // winner, with its deterministic outcome, and exactly one batch.
    for (let i = 0; i < cohort.length; i++) {
      const { participantId } = cohort[i]!;
      const predRows = await db
        .select()
        .from(predictions)
        .where(
          and(
            eq(predictions.participantId, participantId),
            eq(predictions.questionId, winnerQuestionId),
          ),
        );
      expect(predRows).toHaveLength(1);
      expect(predRows[0]!.outcome).toBe(outcomeForIndex(i));

      const decisionRows = await db
        .select()
        .from(agentDecisions)
        .where(
          and(
            eq(agentDecisions.participantId, participantId),
            eq(agentDecisions.questionId, winnerQuestionId),
          ),
        );
      expect(decisionRows).toHaveLength(1);
      expect(decisionRows[0]!.outcome).toBe(outcomeForIndex(i));

      const batchRows = await db
        .select()
        .from(predictionBatches)
        .where(eq(predictionBatches.participantId, participantId));
      expect(batchRows).toHaveLength(1);
      // Agents have wallets, so the shared chain path confirmed the batch.
      expect(batchRows[0]!.chainStatus).toBe("confirmed");
    }
  });

  it("step 4 — resubmitting batch 1 verbatim is idempotent (same ids, no new rows)", async () => {
    const firstFive = cohort.slice(0, 5);
    const resend = await submit(
      cohortToken,
      firstFive.map((a, i) => ({
        agent_key: a.agentKey,
        question_id: winnerQuestionId,
        outcome: outcomeForIndex(i),
        confidence: 0.9,
        rationale: "resend should not overwrite",
      })),
    );
    expect(resend.status).toBe(200);
    const body: SubmitBody = await resend.json();
    expect(body.results.every((r) => r.ok)).toBe(true);
    expect(body.results.map((r) => r.predictionId)).toEqual(batch1PredictionIds);

    // Row counts unchanged: still one prediction + one decision each.
    for (const agent of firstFive) {
      const predRows = await db
        .select()
        .from(predictions)
        .where(
          and(
            eq(predictions.participantId, agent.participantId),
            eq(predictions.questionId, winnerQuestionId),
          ),
        );
      expect(predRows).toHaveLength(1);
      const decisionRows = await db
        .select()
        .from(agentDecisions)
        .where(
          and(
            eq(agentDecisions.participantId, agent.participantId),
            eq(agentDecisions.questionId, winnerQuestionId),
          ),
        );
      expect(decisionRows).toHaveLength(1);
      // First-write-wins: the resend's rationale never overwrote the original.
      expect(decisionRows[0]!.rationale).not.toBe("resend should not overwrite");
    }
    void batch1AgentKeys;
  });

  it("step 5 — settlement scores each agent's prediction exactly once on the right participant", async () => {
    // Drive the fixture to finished with the stats that make the winner "yes".
    await db
      .update(fixtures)
      .set({
        gameState: "finished",
        stats: {
          full_time: {
            home: { goals: 2, yellowCards: 1, redCards: 0, corners: 5 },
            away: { goals: 1, yellowCards: 2, redCards: 0, corners: 3 },
          },
        },
      })
      .where(eq(fixtures.id, fixtureId));

    // Move the winner into settling (the fixture-bus terminal transition the
    // scheduler would perform); leave the secondaries open for step 7.
    await db
      .update(questions)
      .set({ status: "settling", settlingAt: new Date() })
      .where(eq(questions.id, winnerQuestionId));

    const executor = createSettlementExecutor({ db, chain });
    const run = await executor.runOnce();
    expect(run.settled).toBeGreaterThanOrEqual(1);

    const [settled] = await db
      .select()
      .from(questions)
      .where(eq(questions.id, winnerQuestionId));
    expect(settled!.status).toBe("settled");
    // A clean yes/no settlement (no push) from the seeded 2-1 stats.
    expect(settled!.result === "yes" || settled!.result === "no").toBe(true);
    const result = settled!.result;

    let correctCount = 0;
    for (let i = 0; i < cohort.length; i++) {
      const { participantId } = cohort[i]!;
      const [pred] = await db
        .select()
        .from(predictions)
        .where(
          and(
            eq(predictions.participantId, participantId),
            eq(predictions.questionId, winnerQuestionId),
          ),
        );
      expect(pred!.scoredAt).not.toBeNull();

      const correct = outcomeForIndex(i) === result;
      if (correct) correctCount += 1;
      const [p] = await db
        .select()
        .from(participants)
        .where(eq(participants.id, participantId));
      if (correct) {
        expect(p!.points).toBe(1);
        expect(p!.currentStreak).toBe(1);
        expect(p!.bestStreak).toBe(1);
      } else {
        expect(p!.points).toBe(0);
        expect(p!.currentStreak).toBe(0);
      }
    }
    // Deterministic split: exactly five agents picked the winning outcome.
    expect(correctCount).toBe(5);

    // Exactly once: a second pass reselects nothing and leaves points frozen.
    const [before] = await db
      .select({ points: participants.points })
      .from(participants)
      .where(eq(participants.id, cohort[0]!.participantId));
    await executor.runOnce();
    const [afterRerun] = await db
      .select({ points: participants.points })
      .from(participants)
      .where(eq(participants.id, cohort[0]!.participantId));
    expect(afterRerun!.points).toBe(before!.points);
  });

  it("step 6 — leaderboard shows the agents with kind + cohort, and its filters are exact", async () => {
    const seedNames = new Set(AGENT_SEEDS.map((s) => s.displayName));

    const overall: LeaderboardRow[] = await (await app.request("/api/leaderboard")).json();
    const agentRows = overall.filter((r) => r.kind === "agent");
    expect(agentRows).toHaveLength(10);
    for (const row of agentRows) {
      expect(seedNames.has(row.displayName ?? "")).toBe(true);
      expect(row.cohortName).toBe(COHORT_NAME);
    }
    // Five correct agents scored a point, five did not.
    expect(agentRows.filter((r) => r.points === 1)).toHaveLength(5);
    expect(agentRows.filter((r) => r.points === 0)).toHaveLength(5);

    const agentsOnly: LeaderboardRow[] = await (
      await app.request("/api/leaderboard?kind=agent")
    ).json();
    expect(agentsOnly).toHaveLength(10);
    expect(agentsOnly.every((r) => r.kind === "agent")).toBe(true);

    const humansOnly: LeaderboardRow[] = await (
      await app.request("/api/leaderboard?kind=human")
    ).json();
    expect(humansOnly.every((r) => r.kind === "human")).toBe(true);
    expect(humansOnly.some((r) => seedNames.has(r.displayName ?? ""))).toBe(false);
  });

  it("step 7 — pausing one agent isolates it: nine players, its submit rejected, others intact", async () => {
    const paused = cohort[0]!; // an even-index (correct) agent
    const pointsBefore = new Map<string, number>();
    for (const agent of cohort) {
      const [p] = await db
        .select({ points: participants.points })
        .from(participants)
        .where(eq(participants.id, agent.participantId));
      pointsBefore.set(agent.participantId, p!.points);
    }

    await db.update(agents).set({ status: "paused" }).where(eq(agents.agentKey, paused.agentKey));

    // Pending now lists nine active players; the paused one is gone.
    const pendingRes = await pending(cohortToken);
    const pendingBody: PendingBody = await pendingRes.json();
    expect(pendingBody.players).toHaveLength(9);
    expect(pendingBody.players.some((p) => p.agent_key === paused.agentKey)).toBe(false);

    // Submitting for the paused agent (on a still-open secondary) is rejected —
    // a paused key is not an active identity.
    const rejected = await submit(cohortToken, [
      {
        agent_key: paused.agentKey,
        question_id: openSecondaryId,
        outcome: "higher",
        confidence: 0.5,
        rationale: "should not land",
      },
    ]);
    const rejectedBody: SubmitBody = await rejected.json();
    expect(rejectedBody.results[0]).toMatchObject({ ok: false, error: "unknown_agent" });

    // Nothing was written for the paused participant on that question.
    const strayRows = await db
      .select()
      .from(predictions)
      .where(
        and(
          eq(predictions.participantId, paused.participantId),
          eq(predictions.questionId, openSecondaryId),
        ),
      );
    expect(strayRows).toHaveLength(0);

    // The other nine are untouched: points exactly as step 5 left them.
    const others = cohort.filter((a) => a.agentKey !== paused.agentKey);
    const otherIds = others.map((a) => a.participantId);
    const after = await db
      .select({ id: participants.id, points: participants.points })
      .from(participants)
      .where(inArray(participants.id, otherIds));
    for (const row of after) {
      expect(row.points).toBe(pointsBefore.get(row.id));
    }
  });
});
