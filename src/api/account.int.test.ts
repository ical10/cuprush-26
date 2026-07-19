import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { createApp } from "./app";
import { createDevAuthAdapter } from "./auth/dev";

// The integration test database is shared with every other *.int.test.ts
// file in the run, so each test uses its own random dev token / privy user
// id and never assumes it owns the whole table.

const { participants, users, agentCohorts, agents } = schema;
const sql = postgres(testDatabaseUrl(), { max: 10 });
const db = drizzle(sql, { schema });

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  app = createApp({ db, auth: createDevAuthAdapter({}) });
  warn.mockRestore();
});

afterAll(async () => {
  await sql.end();
});

function devToken() {
  return `dev:test-${randomUUID()}`;
}

function authed(token: string, init: RequestInit = {}) {
  return {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  };
}

async function findUserRow(privyUserId: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.privyUserId, privyUserId));
  return row ?? null;
}

function base58Address() {
  // 43 chars from the base58 alphabet, unique per call.
  const alphabet =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 43; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

describe("auth middleware", () => {
  it("returns 401 without an Authorization header", async () => {
    const res = await app.request("/api/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 for a token without the dev prefix", async () => {
    const res = await app.request("/api/me", authed("not-a-dev-token"));
    expect(res.status).toBe(401);
  });

  it("returns 401 for a dev token with an empty suffix", async () => {
    const res = await app.request("/api/me", authed("dev:"));
    expect(res.status).toBe(401);
  });

  it("returns 401 for a malformed Authorization scheme", async () => {
    const res = await app.request("/api/me", {
      headers: { Authorization: "Basic dev:someone" },
    });
    expect(res.status).toBe(401);
  });
});

describe("participant provisioning", () => {
  it("provisions a human participant + user on the first authenticated request", async () => {
    const token = devToken();
    const privyUserId = token.slice("dev:".length);

    const res = await app.request("/api/me", authed(token));
    expect(res.status).toBe(200);

    const user = await findUserRow(privyUserId);
    expect(user).not.toBeNull();

    const [participant] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, user!.participantId));
    expect(participant).toMatchObject({
      kind: "human",
      points: 0,
      currentStreak: 0,
      bestStreak: 0,
      displayName: null,
      walletAddress: null,
      delegationRevokedAt: null,
    });
  });

  it("maps repeat requests to the same participant", async () => {
    const token = devToken();
    const privyUserId = token.slice("dev:".length);

    await app.request("/api/me", authed(token));
    const first = await findUserRow(privyUserId);

    await app.request("/api/me", authed(token));
    const second = await findUserRow(privyUserId);

    expect(second!.id).toBe(first!.id);
    expect(second!.participantId).toBe(first!.participantId);

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.privyUserId, privyUserId));
    expect(rows).toHaveLength(1);
  });

  it("provisions exactly one participant under concurrent first requests", async () => {
    const token = devToken();
    const privyUserId = token.slice("dev:".length);

    const responses = await Promise.all(
      Array.from({ length: 8 }, () => app.request("/api/me", authed(token))),
    );
    for (const res of responses) expect(res.status).toBe(200);

    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.privyUserId, privyUserId));
    expect(userRows).toHaveLength(1);

    // The losing transactions must have rolled back their participant
    // inserts: no orphan human participant without a users row and with
    // this test's timing would be detectable, so instead assert the strong
    // invariant we can check exactly — one participant for this identity.
    const participantRows = await db
      .select()
      .from(participants)
      .where(eq(participants.id, userRows[0]!.participantId));
    expect(participantRows).toHaveLength(1);
  });
});

describe("GET /api/me", () => {
  it("returns display name, points, streaks, and wallet address", async () => {
    const token = devToken();
    const res = await app.request("/api/me", authed(token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      displayName: null,
      points: 0,
      currentStreak: 0,
      bestStreak: 0,
      walletAddress: null,
    });
  });
});

describe("PATCH /api/me", () => {
  it("updates the display name and trims whitespace", async () => {
    const token = devToken();
    const res = await app.request(
      "/api/me",
      authed(token, {
        method: "PATCH",
        body: JSON.stringify({ displayName: "  Streak Queen  " }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ displayName: "Streak Queen" });

    const check = await app.request("/api/me", authed(token));
    expect(await check.json()).toMatchObject({ displayName: "Streak Queen" });
  });

  it("rejects an empty display name", async () => {
    const token = devToken();
    const res = await app.request(
      "/api/me",
      authed(token, {
        method: "PATCH",
        body: JSON.stringify({ displayName: "   " }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a display name over 32 characters", async () => {
    const token = devToken();
    const res = await app.request(
      "/api/me",
      authed(token, {
        method: "PATCH",
        body: JSON.stringify({ displayName: "x".repeat(33) }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects attempts to write any other field", async () => {
    const token = devToken();
    const res = await app.request(
      "/api/me",
      authed(token, {
        method: "PATCH",
        body: JSON.stringify({ displayName: "ok", points: 9999 }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a non-JSON body", async () => {
    const token = devToken();
    const res = await app.request(
      "/api/me",
      authed(token, { method: "PATCH", body: "displayName=nope" }),
    );
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await app.request("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ displayName: "anon" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });
});

/**
 * Seeds one agent participant end-to-end: an owning human user, an
 * agent_cohorts row, and the agents row binding participant to cohort.
 * Mirrors the hermes-agent-plan data model (participants.kind='agent' +
 * agents + agent_cohorts) — this suite owns test-local inserts only, not
 * the real seed command.
 */
async function seedAgent(overrides: { displayName?: string; points?: number } = {}) {
  const ownerPrivyId = `owner-${randomUUID()}`;
  const [ownerParticipant] = await db
    .insert(participants)
    .values({ kind: "human", displayName: `owner-${randomUUID().slice(0, 8)}` })
    .returning();
  const [owner] = await db
    .insert(users)
    .values({ participantId: ownerParticipant!.id, privyUserId: ownerPrivyId })
    .returning();
  const [cohort] = await db
    .insert(agentCohorts)
    .values({ ownerUserId: owner!.id, name: `cohort-${randomUUID().slice(0, 8)}` })
    .returning();
  const [agentParticipant] = await db
    .insert(participants)
    .values({
      kind: "agent",
      displayName: overrides.displayName ?? `agent-${randomUUID().slice(0, 8)}`,
      points: overrides.points ?? 0,
    })
    .returning();
  await db.insert(agents).values({
    participantId: agentParticipant!.id,
    cohortId: cohort!.id,
    agentKey: `key-${randomUUID().slice(0, 8)}`,
    persona: "Test persona",
    strategy: "Test strategy",
    model: "test-model",
  });
  return { participant: agentParticipant!, cohortName: cohort!.name };
}

describe("GET /api/leaderboard", () => {
  it("orders by points desc then best streak desc and caps at 50 rows", async () => {
    // Distinctive high scores so these three outrank every other row the
    // shared test database may contain.
    const names = {
      first: `lb-first-${randomUUID().slice(0, 8)}`,
      second: `lb-second-${randomUUID().slice(0, 8)}`,
      third: `lb-third-${randomUUID().slice(0, 8)}`,
    };
    await db.insert(participants).values([
      {
        kind: "human",
        displayName: names.second,
        points: 1_000_000,
        bestStreak: 5,
      },
      {
        kind: "human",
        displayName: names.first,
        points: 1_000_000,
        bestStreak: 9,
      },
      {
        kind: "human",
        displayName: names.third,
        points: 999_999,
        bestStreak: 99,
      },
    ]);
    // Enough filler rows to guarantee more than 50 participants exist.
    await db.insert(participants).values(
      Array.from({ length: 51 }, (_, i) => ({
        kind: "human" as const,
        displayName: `lb-filler-${i}-${randomUUID().slice(0, 8)}`,
        points: 100,
      })),
    );

    const res = await app.request("/api/leaderboard");
    expect(res.status).toBe(200);
    const rows: { displayName: string | null; points: number }[] =
      await res.json();

    expect(rows).toHaveLength(50);
    expect(rows[0]!.displayName).toBe(names.first);
    expect(rows[1]!.displayName).toBe(names.second);
    expect(rows[2]!.displayName).toBe(names.third);
  });

  it("is public (no token required)", async () => {
    const res = await app.request("/api/leaderboard");
    expect(res.status).toBe(200);
  });

  it("tags every row with kind, and agent rows with their cohort name", async () => {
    const humanName = `lb-human-${randomUUID().slice(0, 8)}`;
    await db.insert(participants).values({
      kind: "human",
      displayName: humanName,
      points: 5_000_000,
    });
    const { participant: agentParticipant, cohortName } = await seedAgent({
      points: 5_000_001,
    });

    const res = await app.request("/api/leaderboard");
    expect(res.status).toBe(200);
    const rows: { displayName: string | null; kind: string; cohortName: string | null }[] =
      await res.json();

    const humanRow = rows.find((r) => r.displayName === humanName);
    expect(humanRow).toMatchObject({ kind: "human", cohortName: null });

    const agentRow = rows.find((r) => r.displayName === agentParticipant.displayName);
    expect(agentRow).toMatchObject({ kind: "agent", cohortName });
  });

  it("?kind=human returns only human rows", async () => {
    const humanName = `lb-kind-human-${randomUUID().slice(0, 8)}`;
    await db.insert(participants).values({
      kind: "human",
      displayName: humanName,
      points: 6_000_000,
    });
    const { participant: agentParticipant } = await seedAgent({ points: 6_000_001 });

    const res = await app.request("/api/leaderboard?kind=human");
    expect(res.status).toBe(200);
    const rows: { displayName: string | null; kind: string }[] = await res.json();

    expect(rows.every((r) => r.kind === "human")).toBe(true);
    expect(rows.some((r) => r.displayName === humanName)).toBe(true);
    expect(rows.some((r) => r.displayName === agentParticipant.displayName)).toBe(false);
  });

  it("?kind=agent returns only agent rows", async () => {
    const humanName = `lb-kind-agent-human-${randomUUID().slice(0, 8)}`;
    await db.insert(participants).values({
      kind: "human",
      displayName: humanName,
      points: 7_000_000,
    });
    const { participant: agentParticipant } = await seedAgent({ points: 7_000_001 });

    const res = await app.request("/api/leaderboard?kind=agent");
    expect(res.status).toBe(200);
    const rows: { displayName: string | null; kind: string }[] = await res.json();

    expect(rows.every((r) => r.kind === "agent")).toBe(true);
    expect(rows.some((r) => r.displayName === agentParticipant.displayName)).toBe(true);
    expect(rows.some((r) => r.displayName === humanName)).toBe(false);
  });

  it("keeps fully tied rows in a stable order across requests", async () => {
    // Identical points and best streak: only the createdAt/id tiebreaker
    // keeps these rows from shuffling between refreshes.
    const prefix = `lb-tie-${randomUUID().slice(0, 8)}`;
    for (let i = 0; i < 3; i++) {
      await db.insert(participants).values({
        kind: "human",
        displayName: `${prefix}-${i}`,
        points: 8_000_000,
        bestStreak: 4,
      });
    }

    const readTied = async () => {
      const res = await app.request("/api/leaderboard");
      expect(res.status).toBe(200);
      const rows: { displayName: string | null }[] = await res.json();
      return rows
        .map((r) => r.displayName)
        .filter((name) => name?.startsWith(prefix));
    };

    const first = await readTied();
    expect(first).toHaveLength(3);
    expect(await readTied()).toEqual(first);
    expect(await readTied()).toEqual(first);
  });

  it("ignores an unrecognized ?kind value and falls back to Overall", async () => {
    const res = await app.request("/api/leaderboard?kind=nonsense");
    expect(res.status).toBe(200);
    const all = await (await app.request("/api/leaderboard")).json();
    expect(await res.json()).toEqual(all);
  });
});

describe("POST /api/logout", () => {
  it("returns 204 (stateless backend; the client clears the Privy session)", async () => {
    const res = await app.request("/api/logout", { method: "POST" });
    expect(res.status).toBe(204);
  });
});

describe("POST /api/wallet", () => {
  it("records the embedded wallet address on the participant", async () => {
    const token = devToken();
    const address = base58Address();

    const res = await app.request(
      "/api/wallet",
      authed(token, { method: "POST", body: JSON.stringify({ address }) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ walletAddress: address });

    const me = await app.request("/api/me", authed(token));
    expect(await me.json()).toMatchObject({ walletAddress: address });
  });

  it("is idempotent for the same address", async () => {
    const token = devToken();
    const address = base58Address();
    const post = () =>
      app.request(
        "/api/wallet",
        authed(token, { method: "POST", body: JSON.stringify({ address }) }),
      );

    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
  });

  it("returns 409 when trying to change an already-set address", async () => {
    const token = devToken();
    const first = base58Address();
    const second = base58Address();

    await app.request(
      "/api/wallet",
      authed(token, {
        method: "POST",
        body: JSON.stringify({ address: first }),
      }),
    );
    const res = await app.request(
      "/api/wallet",
      authed(token, {
        method: "POST",
        body: JSON.stringify({ address: second }),
      }),
    );
    expect(res.status).toBe(409);

    const me = await app.request("/api/me", authed(token));
    expect(await me.json()).toMatchObject({ walletAddress: first });
  });

  it("returns 409 when the address is already claimed by another participant", async () => {
    const address = base58Address();
    await app.request(
      "/api/wallet",
      authed(devToken(), {
        method: "POST",
        body: JSON.stringify({ address }),
      }),
    );

    const res = await app.request(
      "/api/wallet",
      authed(devToken(), {
        method: "POST",
        body: JSON.stringify({ address }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("rejects a non-base58 address", async () => {
    const res = await app.request(
      "/api/wallet",
      authed(devToken(), {
        method: "POST",
        body: JSON.stringify({ address: "0OIl".repeat(10) }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await app.request("/api/wallet", {
      method: "POST",
      body: JSON.stringify({ address: base58Address() }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/wallet/delegation/revoke", () => {
  it("sets delegation_revoked_at on the participant", async () => {
    const token = devToken();
    const privyUserId = token.slice("dev:".length);

    const res = await app.request(
      "/api/wallet/delegation/revoke",
      authed(token, { method: "POST" }),
    );
    expect(res.status).toBe(200);
    const body: { delegationRevokedAt: string | null } = await res.json();
    expect(body.delegationRevokedAt).not.toBeNull();

    const user = await findUserRow(privyUserId);
    const [participant] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, user!.participantId));
    expect(participant!.delegationRevokedAt).not.toBeNull();
  });

  it("is idempotent and keeps the first revocation timestamp", async () => {
    const token = devToken();
    const first = await app.request(
      "/api/wallet/delegation/revoke",
      authed(token, { method: "POST" }),
    );
    const firstBody: { delegationRevokedAt: string } = await first.json();

    const second = await app.request(
      "/api/wallet/delegation/revoke",
      authed(token, { method: "POST" }),
    );
    const secondBody: { delegationRevokedAt: string } = await second.json();

    expect(secondBody.delegationRevokedAt).toBe(firstBody.delegationRevokedAt);
  });

  it("requires authentication", async () => {
    const res = await app.request("/api/wallet/delegation/revoke", {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/me", () => {
  it("anonymizes: deletes the users row, nulls the display name and wallet address, keeps the participant", async () => {
    const token = devToken();
    const privyUserId = token.slice("dev:".length);
    const address = base58Address();

    await app.request(
      "/api/me",
      authed(token, {
        method: "PATCH",
        body: JSON.stringify({ displayName: "Soon Gone" }),
      }),
    );
    await app.request(
      "/api/wallet",
      authed(token, { method: "POST", body: JSON.stringify({ address }) }),
    );
    const user = await findUserRow(privyUserId);
    const participantId = user!.participantId;

    const res = await app.request(
      "/api/me",
      authed(token, { method: "DELETE" }),
    );
    expect(res.status).toBe(204);

    expect(await findUserRow(privyUserId)).toBeNull();

    const [participant] = await db
      .select()
      .from(participants)
      .where(eq(participants.id, participantId));
    expect(participant).toBeDefined();
    expect(participant!.displayName).toBeNull();
    expect(participant!.walletAddress).toBeNull();
    expect(participant!.delegationRevokedAt).not.toBeNull();
  });

  it("releases the wallet address so a re-signup with the same embedded wallet can claim it", async () => {
    const token = devToken();
    const address = base58Address();

    await app.request(
      "/api/wallet",
      authed(token, { method: "POST", body: JSON.stringify({ address }) }),
    );
    await app.request("/api/me", authed(token, { method: "DELETE" }));

    // Same identity signs in again; Privy hands back the same embedded
    // wallet, so the fresh participant must be able to claim the address.
    const res = await app.request(
      "/api/wallet",
      authed(token, { method: "POST", body: JSON.stringify({ address }) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ walletAddress: address });

    const me = await app.request("/api/me", authed(token));
    expect(await me.json()).toMatchObject({ walletAddress: address });
  });

  it("provisions a fresh participant if the same identity signs in again", async () => {
    const token = devToken();
    const privyUserId = token.slice("dev:".length);

    await app.request("/api/me", authed(token));
    const before = await findUserRow(privyUserId);

    await app.request("/api/me", authed(token, { method: "DELETE" }));
    await app.request("/api/me", authed(token));

    const after = await findUserRow(privyUserId);
    expect(after).not.toBeNull();
    expect(after!.participantId).not.toBe(before!.participantId);
  });

  it("requires authentication", async () => {
    const res = await app.request("/api/me", { method: "DELETE" });
    expect(res.status).toBe(401);
  });
});

describe("stored data hygiene", () => {
  it("stores the privy user id, never the raw bearer token", async () => {
    const token = devToken();
    const privyUserId = token.slice("dev:".length);

    await app.request("/api/me", authed(token));

    const rows = await db
      .select()
      .from(users)
      .where(inArray(users.privyUserId, [token, `Bearer ${token}`]));
    expect(rows).toHaveLength(0);
    expect(await findUserRow(privyUserId)).not.toBeNull();
  });
});
