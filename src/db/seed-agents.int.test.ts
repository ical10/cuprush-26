import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "./client";
import { testDatabaseUrl } from "./test/test-db";
import { AGENT_SEEDS, COHORT_NAME, seedAgents } from "./seed-agents";
import * as schema from "./schema";
import { agentCohorts, agents, participants, users } from "./schema";

const client = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(client, { schema });

async function resetAgentTables() {
  await db.execute(sql`DELETE FROM agent_decisions`);
  await db.execute(sql`DELETE FROM agents`);
  await db.execute(sql`DELETE FROM agent_cohorts`);
  await db.execute(sql`DELETE FROM participants WHERE kind = 'agent'`);
}

async function createOwner() {
  const [participant] = await db
    .insert(participants)
    .values({ kind: "human" })
    .returning({ id: participants.id });
  if (!participant) throw new Error("owner participant insert failed");
  await db
    .insert(users)
    .values({ participantId: participant.id, privyUserId: `owner-${randomUUID()}` });
}

async function counts() {
  const [cohort] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentCohorts)
    .where(eq(agentCohorts.name, COHORT_NAME));
  const [agentRows] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agents);
  const [agentParticipants] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(participants)
    .where(eq(participants.kind, "agent"));
  return {
    cohorts: cohort?.count ?? 0,
    agents: agentRows?.count ?? 0,
    agentParticipants: agentParticipants?.count ?? 0,
  };
}

beforeAll(async () => {
  await resetAgentTables();
  await createOwner();
});

afterAll(async () => {
  await client.end();
});

describe("seedAgents", () => {
  it("refuses to run when the users table is empty", async () => {
    // Wipe everything inside a rolled-back transaction so other integration
    // files' data is restored, then confirm the seed refuses with no owner.
    await expect(
      db.transaction(async (tx) => {
        await tx.execute(
          sql`TRUNCATE users, participants, agents, agent_cohorts, agent_decisions, predictions, prediction_batches CASCADE`,
        );
        await seedAgents(tx as unknown as Database);
      }),
    ).rejects.toThrow(/cohort owner/i);
  });

  it("creates one cohort, ten participants, and ten agents", async () => {
    const summary = await seedAgents(db);
    expect(summary.cohortCreated).toBe(true);
    expect(summary.agentsCreated).toBe(AGENT_SEEDS.length);
    expect(summary.agentsSkipped).toBe(0);

    const after = await counts();
    expect(after.cohorts).toBe(1);
    expect(after.agents).toBe(10);
    expect(after.agentParticipants).toBe(10);
  });

  it("is idempotent: re-running adds nothing", async () => {
    const before = await counts();
    const summary = await seedAgents(db);
    expect(summary.cohortCreated).toBe(false);
    expect(summary.agentsCreated).toBe(0);
    expect(summary.agentsSkipped).toBe(AGENT_SEEDS.length);

    const after = await counts();
    expect(after).toEqual(before);
  });
});
