import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import {
  agentCohorts,
  agents,
  participants,
  users,
} from "../db/schema";
import { provisionAgents, type WalletCreator } from "./provision";

const client = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(client, { schema });

const TEST_ENV: NodeJS.ProcessEnv = { NODE_ENV: "test" };

function recordingCreator(): { creator: WalletCreator; keys: string[] } {
  const keys: string[] = [];
  const creator: WalletCreator = async ({ agentKey, idempotencyKey }) => {
    keys.push(idempotencyKey);
    return { walletId: `wid-${agentKey}`, address: `wallet-${agentKey}` };
  };
  return { creator, keys };
}

async function resetAgentTables() {
  await db.execute(sql`DELETE FROM agent_decisions`);
  await db.execute(sql`DELETE FROM agents`);
  await db.execute(sql`DELETE FROM agent_cohorts`);
  await db.execute(sql`DELETE FROM participants WHERE kind = 'agent'`);
}

async function createCohort(): Promise<string> {
  const [participant] = await db
    .insert(participants)
    .values({ kind: "human" })
    .returning({ id: participants.id });
  if (!participant) throw new Error("owner participant insert failed");
  const [owner] = await db
    .insert(users)
    .values({ participantId: participant.id, privyUserId: `owner-${randomUUID()}` })
    .returning({ id: users.id });
  if (!owner) throw new Error("owner user insert failed");
  const [cohort] = await db
    .insert(agentCohorts)
    .values({ ownerUserId: owner.id, name: `cohort-${randomUUID().slice(0, 8)}` })
    .returning({ id: agentCohorts.id });
  if (!cohort) throw new Error("cohort insert failed");
  return cohort.id;
}

async function insertAgent(input: {
  cohortId: string;
  agentKey: string;
  status?: "seeded" | "active";
  privyWalletId?: string;
  walletAddress?: string;
}): Promise<string> {
  const [participant] = await db
    .insert(participants)
    .values({ kind: "agent", displayName: input.agentKey, walletAddress: input.walletAddress })
    .returning({ id: participants.id });
  if (!participant) throw new Error("agent participant insert failed");
  await db.insert(agents).values({
    participantId: participant.id,
    cohortId: input.cohortId,
    agentKey: input.agentKey,
    persona: "p",
    strategy: "s",
    model: "hermes-pinned",
    status: input.status ?? "seeded",
    privyWalletId: input.privyWalletId,
  });
  return participant.id;
}

async function loadAgent(participantId: string) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.participantId, participantId));
  const [participant] = await db
    .select()
    .from(participants)
    .where(eq(participants.id, participantId));
  return { agent, participant };
}

beforeEach(resetAgentTables);

afterAll(async () => {
  await client.end();
});

describe("provisionAgents", () => {
  it("provisions seeded agents and skips already-provisioned ones", async () => {
    const cohortId = await createCohort();
    const seededId = await insertAgent({ cohortId, agentKey: "seeded-one" });
    const doneId = await insertAgent({
      cohortId,
      agentKey: "done-one",
      status: "active",
      privyWalletId: "wid-existing",
      walletAddress: "wallet-existing",
    });

    const { creator, keys } = recordingCreator();
    const summary = await provisionAgents({ db, createWallet: creator, env: TEST_ENV });

    // The provisioned agent is never re-created.
    expect(keys).toEqual(["hilo-test-seeded-one"]);
    expect(summary.walletsCreated).toBe(1);
    expect(summary.alreadyProvisioned).toBe(1);
    expect(summary.activated).toBe(1);

    const seeded = await loadAgent(seededId);
    expect(seeded.agent?.privyWalletId).toBe("wid-seeded-one");
    expect(seeded.agent?.status).toBe("active");
    expect(seeded.participant?.walletAddress).toBe("wallet-seeded-one");

    const done = await loadAgent(doneId);
    expect(done.agent?.privyWalletId).toBe("wid-existing");
  });

  it("keeps the first-written wallet address (first-write-wins)", async () => {
    const cohortId = await createCohort();
    const id = await insertAgent({
      cohortId,
      agentKey: "has-address",
      walletAddress: "pre-existing-address",
    });

    const { creator } = recordingCreator();
    await provisionAgents({ db, createWallet: creator, env: TEST_ENV });

    const { agent, participant } = await loadAgent(id);
    // Wallet id + activation still applied, but the address is not overwritten.
    expect(agent?.privyWalletId).toBe("wid-has-address");
    expect(agent?.status).toBe("active");
    expect(participant?.walletAddress).toBe("pre-existing-address");
  });

  it("does not activate an agent when wallet creation fails", async () => {
    const cohortId = await createCohort();
    const id = await insertAgent({ cohortId, agentKey: "will-fail" });

    const failing: WalletCreator = async () => {
      throw new Error("privy boom");
    };

    await expect(
      provisionAgents({ db, createWallet: failing, env: TEST_ENV }),
    ).rejects.toThrow(/privy boom/);

    const { agent, participant } = await loadAgent(id);
    expect(agent?.status).toBe("seeded");
    expect(agent?.privyWalletId).toBeNull();
    expect(participant?.walletAddress).toBeNull();
  });

  it("prints the cohort token exactly once, then treats rotation as manual", async () => {
    const cohortId = await createCohort();
    await insertAgent({ cohortId, agentKey: "tok-agent" });

    const firstLog: string[] = [];
    const { creator } = recordingCreator();
    const first = await provisionAgents({
      db,
      createWallet: creator,
      env: TEST_ENV,
      log: (m) => firstLog.push(m),
    });

    expect(first.tokenIssued).toBe(true);
    const bannerLines = firstLog.filter((line) => line.includes("will NOT be shown again"));
    expect(bannerLines).toHaveLength(1);
    const tokenLines = firstLog.filter((line) => line.trimStart().startsWith("token:"));
    expect(tokenLines).toHaveLength(1);

    const [cohortAfter] = await db
      .select({ tokenHash: agentCohorts.tokenHash })
      .from(agentCohorts)
      .where(eq(agentCohorts.id, cohortId));
    expect(cohortAfter?.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    // Re-running never re-prints or rotates the token.
    const secondLog: string[] = [];
    const { creator: creator2 } = recordingCreator();
    const second = await provisionAgents({
      db,
      createWallet: creator2,
      env: TEST_ENV,
      log: (m) => secondLog.push(m),
    });
    expect(second.tokenIssued).toBe(false);
    expect(secondLog.some((line) => line.includes("will NOT be shown again"))).toBe(false);
    expect(secondLog.some((line) => line.includes("rotation is a"))).toBe(true);

    const [cohortFinal] = await db
      .select({ tokenHash: agentCohorts.tokenHash })
      .from(agentCohorts)
      .where(eq(agentCohorts.id, cohortId));
    expect(cohortFinal?.tokenHash).toBe(cohortAfter?.tokenHash);
  });
});
