import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { inArray } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { createReplayTxLineClient } from "./replay-client";

const { fixtures } = schema;
const sql = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(sql, { schema });

// Distinct ids/teams so this file never collides with other integration files
// sharing the same database. TxLINE FixtureId is numeric on the wire; the DB
// row id is its string form.
const ALLOWED_FIXTURE = 990001;
const DISALLOWED_FIXTURE = 990002;
const ALLOWED_ID = String(ALLOWED_FIXTURE);
const DISALLOWED_ID = String(DISALLOWED_FIXTURE);

function replayFile(fixtureId: number, home: string, away: string) {
  return {
    snapshot: {
      StartTime: Date.parse("2030-06-20T12:00:00.000Z"),
      Participant1: home,
      Participant2: away,
      FixtureId: fixtureId,
      Participant1IsHome: true,
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
  fixturesDir = await mkdtemp(path.join(tmpdir(), "txline-allowlist-"));
  await writeFile(
    path.join(fixturesDir, "allowed.json"),
    JSON.stringify(replayFile(ALLOWED_FIXTURE, "Spain", "Argentina")),
  );
  await writeFile(
    path.join(fixturesDir, "disallowed.json"),
    JSON.stringify(replayFile(DISALLOWED_FIXTURE, "Myanmar", "Vietnam")),
  );
});

afterAll(async () => {
  await db.delete(fixtures).where(inArray(fixtures.id, [ALLOWED_ID, DISALLOWED_ID]));
  await rm(fixturesDir, { recursive: true, force: true });
  await sql.end();
});

describe("replay ingestion with TXLINE_TEAM_ALLOWLIST", () => {
  it("ingests only fixtures whose both teams are allowed and logs the skip", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const client = createReplayTxLineClient({
        db,
        fixturesDir,
        intervalMs: 0,
        env: { TXLINE_TEAM_ALLOWLIST: "Spain,Argentina" } as NodeJS.ProcessEnv,
      });
      await client.start();
      await client.stop();

      const rows = await db
        .select()
        .from(fixtures)
        .where(inArray(fixtures.id, [ALLOWED_ID, DISALLOWED_ID]));
      const ids = rows.map((row) => row.id);

      expect(ids).toContain(ALLOWED_ID);
      expect(ids).not.toContain(DISALLOWED_ID);
      // Allowed fixture still processed its events end-to-end.
      expect(rows.find((row) => row.id === ALLOWED_ID)?.lastSeq).toBe(1);

      expect(warn).toHaveBeenCalledWith(expect.stringContaining(DISALLOWED_ID));
    } finally {
      warn.mockRestore();
    }
  });
});
