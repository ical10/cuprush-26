import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { inArray } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { createReplayTxLineClient } from "./replay-client";

const { fixtures } = schema;
const sql = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(sql, { schema });

// Distinct ids/teams so this file never collides with other integration files
// sharing the same database. TxLINE FixtureId is numeric on the wire; the DB
// row id is its string form.
const WORLD_CUP_FIXTURE = 990001;
const FRIENDLY_FIXTURE = 990002;
const WORLD_CUP_ID = String(WORLD_CUP_FIXTURE);
const FRIENDLY_ID = String(FRIENDLY_FIXTURE);
const WORLD_CUP_ID_NUM = 72;
const FRIENDLY_ID_NUM = 430;

function replayFile(
  fixtureId: number,
  home: string,
  away: string,
  competition: string,
  competitionId: number,
) {
  return {
    snapshot: {
      StartTime: Date.parse("2030-06-20T12:00:00.000Z"),
      Participant1: home,
      Participant2: away,
      FixtureId: fixtureId,
      Participant1IsHome: true,
      Competition: competition,
      CompetitionId: competitionId,
    },
    events: [
      {
        FixtureId: fixtureId,
        Seq: 1,
        Ts: Date.parse("2030-06-20T13:00:00.000Z"),
        Action: "goal",
        Participant1IsHome: true,
        Score: { Participant1: { Total: { Goals: 1 } } },
      },
    ],
  };
}

let fixturesDir: string;

beforeAll(async () => {
  fixturesDir = await mkdtemp(path.join(tmpdir(), "txline-competition-"));
  await writeFile(
    path.join(fixturesDir, "world-cup.json"),
    JSON.stringify(replayFile(WORLD_CUP_FIXTURE, "Spain", "Argentina", "World Cup", WORLD_CUP_ID_NUM)),
  );
  await writeFile(
    path.join(fixturesDir, "friendly.json"),
    JSON.stringify(replayFile(FRIENDLY_FIXTURE, "Myanmar", "Vietnam", "Friendlies", FRIENDLY_ID_NUM)),
  );
});

beforeEach(async () => {
  await db.delete(fixtures).where(inArray(fixtures.id, [WORLD_CUP_ID, FRIENDLY_ID]));
});

afterAll(async () => {
  await db.delete(fixtures).where(inArray(fixtures.id, [WORLD_CUP_ID, FRIENDLY_ID]));
  await rm(fixturesDir, { recursive: true, force: true });
  await sql.end();
});

describe("replay ingestion with TXLINE_COMPETITION_ID", () => {
  it("ingests only the matching competition, persists its fields, and logs the skip", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const client = createReplayTxLineClient({
        db,
        fixturesDir,
        intervalMs: 0,
        env: { TXLINE_COMPETITION_ID: "72" } as NodeJS.ProcessEnv,
      });
      await client.start();
      await client.stop();

      const rows = await db
        .select()
        .from(fixtures)
        .where(inArray(fixtures.id, [WORLD_CUP_ID, FRIENDLY_ID]));
      const ids = rows.map((row) => row.id);

      expect(ids).toContain(WORLD_CUP_ID);
      expect(ids).not.toContain(FRIENDLY_ID);

      const worldCup = rows.find((row) => row.id === WORLD_CUP_ID);
      // Competition fields persisted, and the fixture's events applied end-to-end.
      expect(worldCup?.competition).toBe("World Cup");
      expect(worldCup?.competitionId).toBe(WORLD_CUP_ID_NUM);
      expect(worldCup?.lastSeq).toBe(1);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(FRIENDLY_ID));
    } finally {
      warn.mockRestore();
    }
  });

  it("ingests every competition with its fields persisted when the filter is unset", async () => {
    const client = createReplayTxLineClient({ db, fixturesDir, intervalMs: 0 });
    await client.start();
    await client.stop();

    const rows = await db
      .select()
      .from(fixtures)
      .where(inArray(fixtures.id, [WORLD_CUP_ID, FRIENDLY_ID]));
    const byId = new Map(rows.map((row) => [row.id, row]));

    expect(byId.get(WORLD_CUP_ID)?.competitionId).toBe(WORLD_CUP_ID_NUM);
    expect(byId.get(FRIENDLY_ID)?.competitionId).toBe(FRIENDLY_ID_NUM);
    expect(byId.get(FRIENDLY_ID)?.competition).toBe("Friendlies");
  });
});
