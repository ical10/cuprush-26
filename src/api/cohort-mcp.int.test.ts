import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { createApp } from "./app";
import { createDevAuthAdapter } from "./auth/dev";

const {
  agentCohorts,
  agents,
  agentDecisions,
  fixtures,
  participants,
  predictions,
  questions,
  users,
} = schema;

const sql = postgres(testDatabaseUrl(), { max: 10 });
const db = drizzle(sql, { schema });

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  app = createApp({ db, auth: createDevAuthAdapter({}) });
  warn.mockRestore();
});

afterAll(async () => {
  // All integration files share one database. This file seeds agent
  // participants with predictions; the agent-seeding suites reset by deleting
  // `kind = 'agent'` participants, which a lingering prediction blocks via the
  // RESTRICT foreign key. Drop the game rows this file created so those resets
  // stay order-independent.
  await sql`TRUNCATE predictions, prediction_batches, agent_decisions CASCADE`;
  await sql.end();
});

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function base58Address() {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 43; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

async function createOwnerUser() {
  const [participant] = await db.insert(participants).values({}).returning();
  const [user] = await db
    .insert(users)
    .values({
      participantId: participant!.id,
      privyUserId: `did:privy:${randomUUID()}`,
    })
    .returning();
  return user!;
}

async function createCohort(status: schema.AgentCohortStatus = "active") {
  const owner = await createOwnerUser();
  const token = `cohort-${randomUUID()}`;
  const [cohort] = await db
    .insert(agentCohorts)
    .values({
      ownerUserId: owner.id,
      name: `cohort-${randomUUID().slice(0, 8)}`,
      tokenHash: sha256(token),
      status,
    })
    .returning();
  return { cohort: cohort!, token };
}

async function createAgent(cohortId: string) {
  const [participant] = await db
    .insert(participants)
    .values({
      kind: "agent",
      walletAddress: base58Address(),
      displayName: "AI Bot",
    })
    .returning();
  const agentKey = `agent-${randomUUID().slice(0, 20)}`;
  const [agent] = await db
    .insert(agents)
    .values({
      participantId: participant!.id,
      cohortId,
      agentKey,
      persona: "cautious analyst",
      strategy: "value hunter",
      model: "claude-test",
      status: "active",
    })
    .returning();
  return { participant: participant!, agent: agent!, agentKey };
}

async function insertQuestion() {
  const now = Date.now();
  const fixtureId = `fx-${randomUUID().slice(0, 18)}`;
  await db.insert(fixtures).values({
    id: fixtureId,
    homeTeam: "Argentina",
    awayTeam: "France",
    startsAt: new Date(now + 90 * 60_000),
  });
  const [question] = await db
    .insert(questions)
    .values({
      fixtureId,
      template: "winner",
      statKey1: "home.full_time.goals",
      statKey2: "away.full_time.goals",
      period: "full_time",
      operator: "subtract",
      comparison: "greater_than",
      threshold: 0,
      status: "open",
      opensAt: new Date(now - 60 * 60_000),
      locksAt: new Date(now + 60 * 60_000),
      ruleHash: randomBytes(32).toString("hex"),
    })
    .returning();
  return question!;
}

const MCP_URL = new URL("http://localhost/api/cohort/mcp");

/**
 * An MCP client wired to the in-memory test app: the SDK's Streamable-HTTP
 * client transport, but with `fetch` routed to `app.request` (no socket) and
 * the cohort bearer token attached to every request via `requestInit`.
 */
async function connectMcpClient(token?: string) {
  const transport = new StreamableHTTPClientTransport(MCP_URL, {
    fetch: async (url, init) => app.request(url, init),
    requestInit: token
      ? { headers: { Authorization: `Bearer ${token}` } }
      : undefined,
  });
  const client = new Client({ name: "test-hermes", version: "0.0.0" });
  await client.connect(transport);
  return { client, transport };
}

function parseToolJson(result: {
  content: { type: string; text?: string }[];
}): unknown {
  const first = result.content[0];
  if (!first || first.type !== "text" || !first.text) {
    throw new Error("expected text content");
  }
  return JSON.parse(first.text);
}

describe("cohort MCP transport auth", () => {
  it("completes the initialize handshake with a valid active token", async () => {
    const { token } = await createCohort("active");
    const { client, transport } = await connectMcpClient(token);
    expect(client.getServerVersion()?.name).toBe("cuprush-cohort");
    await transport.close();
  });

  it("rejects the handshake with no token (401, before MCP processing)", async () => {
    await expect(connectMcpClient()).rejects.toThrow();
  });

  it("rejects the handshake with an unknown token", async () => {
    await expect(
      connectMcpClient(`cohort-${randomUUID()}`),
    ).rejects.toThrow();
  });

  it("rejects the handshake for a non-active cohort", async () => {
    const { token } = await createCohort("paused");
    await expect(connectMcpClient(token)).rejects.toThrow();
  });
});

describe("cohort MCP tools", () => {
  it("tools/list returns exactly get_pending_work and submit_decisions", async () => {
    const { token } = await createCohort("active");
    const { client, transport } = await connectMcpClient(token);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_pending_work", "submit_decisions"]);
    for (const tool of tools) {
      expect(tool.description && tool.description.length).toBeTruthy();
    }
    await transport.close();
  });

  it("get_pending_work returns the cohort's seeded players and open work", async () => {
    const { cohort, token } = await createCohort("active");
    const { agentKey } = await createAgent(cohort.id);
    const open = await insertQuestion();

    const { client, transport } = await connectMcpClient(token);
    const result = await client.callTool({
      name: "get_pending_work",
      arguments: {},
    });
    const body = parseToolJson(result as never) as {
      players: { agent_key: string; open_questions: { id: string }[] }[];
    };
    const player = body.players.find((p) => p.agent_key === agentKey);
    expect(player).toBeDefined();
    expect(player!.open_questions.map((q) => q.id)).toContain(open.id);
    await transport.close();
  });

  it("submit_decisions stores a valid decision and prediction in the DB", async () => {
    const { cohort, token } = await createCohort("active");
    const { participant, agentKey } = await createAgent(cohort.id);
    const question = await insertQuestion();

    const { client, transport } = await connectMcpClient(token);
    const result = await client.callTool({
      name: "submit_decisions",
      arguments: {
        decisions: [
          {
            agent_key: agentKey,
            question_id: question.id,
            outcome: "yes",
            confidence: 0.72,
            rationale: "home side dominates possession",
          },
        ],
      },
    });
    const body = parseToolJson(result as never) as {
      results: { ok: boolean; predictionId?: string }[];
    };
    expect(body.results[0]!.ok).toBe(true);
    const predictionId = body.results[0]!.predictionId!;

    const [prediction] = await db
      .select()
      .from(predictions)
      .where(eq(predictions.id, predictionId));
    expect(prediction!.participantId).toBe(participant.id);
    expect(prediction!.questionId).toBe(question.id);
    expect(prediction!.outcome).toBe("yes");

    const [decision] = await db
      .select()
      .from(agentDecisions)
      .where(
        and(
          eq(agentDecisions.participantId, participant.id),
          eq(agentDecisions.questionId, question.id),
        ),
      );
    expect(decision!.rationale).toBe("home side dominates possession");
    await transport.close();
  });

  it("submit_decisions rejects a cross-cohort agent_key with unknown_agent", async () => {
    const cohortA = await createCohort("active");
    const cohortB = await createCohort("active");
    const foreign = await createAgent(cohortB.cohort.id);
    const question = await insertQuestion();

    const { client, transport } = await connectMcpClient(cohortA.token);
    const result = await client.callTool({
      name: "submit_decisions",
      arguments: {
        decisions: [
          {
            agent_key: foreign.agentKey,
            question_id: question.id,
            outcome: "yes",
            confidence: 0.5,
            rationale: "forged",
          },
        ],
      },
    });
    const body = parseToolJson(result as never) as {
      results: { ok: boolean; error?: string }[];
    };
    expect(body.results[0]).toMatchObject({ ok: false, error: "unknown_agent" });

    const rows = await db
      .select()
      .from(predictions)
      .where(eq(predictions.participantId, foreign.participant.id));
    expect(rows).toHaveLength(0);
    await transport.close();
  });
});
