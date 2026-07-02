import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { onFixtureUpdate, type FixtureUpdate } from "./bus";
import { createReplayTxLineClient, loadReplayFixtures, DEFAULT_FIXTURES_DIR } from "./replay-client";

const { fixtures } = schema;
const sql = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(sql, { schema });

afterAll(async () => {
  await sql.end();
});

describe("loadReplayFixtures", () => {
  it("parses every sample fixture file as schema-valid", async () => {
    const files = await loadReplayFixtures(DEFAULT_FIXTURES_DIR);

    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const file of files) {
      expect(file.events.length).toBeGreaterThan(0);
    }
  });
});

describe("createReplayTxLineClient", () => {
  it("applies every sample fixture end-to-end on demand", async () => {
    const updates: FixtureUpdate[] = [];
    const unsubscribe = onFixtureUpdate((update) => updates.push(update));

    try {
      const client = createReplayTxLineClient({ db, intervalMs: 0 });
      await client.start();
      await client.stop();

      const files = await loadReplayFixtures(DEFAULT_FIXTURES_DIR);

      for (const file of files) {
        const [row] = await db.select().from(fixtures).where(eq(fixtures.id, file.snapshot.fixtureId));
        const lastEvent = file.events[file.events.length - 1];
        expect(row).toBeDefined();
        expect(row?.lastSeq).toBe(lastEvent?.seq);
        expect(row?.gameState).toBe("finished");
        expect(row?.stats).toEqual(lastEvent?.stats);
      }

      const publishedFixtureIds = new Set(updates.map((update) => update.fixtureId));
      for (const file of files) {
        expect(publishedFixtureIds.has(file.snapshot.fixtureId)).toBe(true);
      }
    } finally {
      unsubscribe();
    }
  });

  it("covers goal, corner, card, and terminal-state events across the samples", async () => {
    const files = await loadReplayFixtures(DEFAULT_FIXTURES_DIR);
    const eventTypes = new Set(files.flatMap((file) => file.events.map((event) => event.type)));

    expect(eventTypes.has("goal")).toBe(true);
    expect(eventTypes.has("corner")).toBe(true);
    expect(eventTypes.has("yellow_card") || eventTypes.has("red_card")).toBe(true);

    const terminalStates = files.map((file) => file.events[file.events.length - 1]?.gameState);
    expect(terminalStates.every((state) => state === "finished")).toBe(true);
  });
});
