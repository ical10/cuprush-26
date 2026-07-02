import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { applyTxLineEvent } from "./apply";
import type { TxLineEvent } from "./schema";

const { fixtures } = schema;
const sql = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(sql, { schema });

afterAll(async () => {
  await sql.end();
});

const baseStats: TxLineEvent["stats"] = {
  full_time: {
    home: { goals: 1, yellowCards: 0, redCards: 0, corners: 3 },
    away: { goals: 0, yellowCards: 1, redCards: 0, corners: 2 },
  },
};

async function insertFixture(overrides: Partial<typeof fixtures.$inferInsert> = {}) {
  const id = overrides.id ?? `fixture-${randomUUID()}`;
  await db.insert(fixtures).values({
    id,
    homeTeam: "Team A",
    awayTeam: "Team B",
    startsAt: new Date(),
    ...overrides,
  });
  return id;
}

function event(overrides: Partial<TxLineEvent> & { fixtureId: string; seq: number }): TxLineEvent {
  return {
    type: "goal",
    gameState: "live",
    occurredAt: new Date().toISOString(),
    stats: baseStats,
    ...overrides,
  };
}

describe("applyTxLineEvent", () => {
  it("applies a newer event and advances last_seq", async () => {
    const fixtureId = await insertFixture();

    const outcome = await applyTxLineEvent(db, event({ fixtureId, seq: 1 }));

    expect(outcome.applied).toBe(true);
    if (!outcome.applied) throw new Error("expected applied outcome");
    expect(outcome.fixture.lastSeq).toBe(1);
    expect(outcome.fixture.gameState).toBe("live");
    expect(outcome.fixture.stats).toEqual(baseStats);
  });

  it("ignores a duplicate seq and leaves last_seq unchanged", async () => {
    const fixtureId = await insertFixture();

    await applyTxLineEvent(db, event({ fixtureId, seq: 1 }));
    const outcome = await applyTxLineEvent(db, event({ fixtureId, seq: 1, type: "corner" }));

    expect(outcome.applied).toBe(false);
    if (outcome.applied) throw new Error("expected ignored outcome");
    expect(outcome.reason).toBe("stale");

    const [row] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    expect(row?.lastSeq).toBe(1);
  });

  it("ignores an out-of-order (older) seq", async () => {
    const fixtureId = await insertFixture();

    await applyTxLineEvent(db, event({ fixtureId, seq: 5 }));
    const outcome = await applyTxLineEvent(db, event({ fixtureId, seq: 3 }));

    expect(outcome.applied).toBe(false);

    const [row] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    expect(row?.lastSeq).toBe(5);
  });

  it("advances last_seq exactly once across duplicate and out-of-order delivery", async () => {
    const fixtureId = await insertFixture();

    const outcomes = [
      await applyTxLineEvent(db, event({ fixtureId, seq: 1 })),
      await applyTxLineEvent(db, event({ fixtureId, seq: 1 })), // duplicate
      await applyTxLineEvent(db, event({ fixtureId, seq: 3 })),
      await applyTxLineEvent(db, event({ fixtureId, seq: 2 })), // late arrival
      await applyTxLineEvent(db, event({ fixtureId, seq: 3 })), // duplicate again
    ];

    const appliedCount = outcomes.filter((o) => o.applied).length;
    expect(appliedCount).toBe(2);

    const [row] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    expect(row?.lastSeq).toBe(3);
  });

  it("reports unknown_fixture for an event with no matching fixture row", async () => {
    const outcome = await applyTxLineEvent(db, event({ fixtureId: `missing-${randomUUID()}`, seq: 1 }));

    expect(outcome.applied).toBe(false);
    if (outcome.applied) throw new Error("expected ignored outcome");
    expect(outcome.reason).toBe("unknown_fixture");
  });

  it("converges to the highest seq under concurrent delivery, never regressing", async () => {
    const fixtureId = await insertFixture();

    // The row lock in applyTxLineEvent serializes these, but arrival order
    // at the lock is not guaranteed — only the end state is: it must land
    // on the highest seq submitted, and last_seq must never go backward.
    const results = await Promise.all([
      applyTxLineEvent(db, event({ fixtureId, seq: 1 })),
      applyTxLineEvent(db, event({ fixtureId, seq: 2 })),
      applyTxLineEvent(db, event({ fixtureId, seq: 3 })),
    ]);

    expect(results.some((r) => r.applied)).toBe(true);

    const [row] = await db.select().from(fixtures).where(eq(fixtures.id, fixtureId));
    expect(row?.lastSeq).toBe(3);
  });
});
