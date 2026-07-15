import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import { testDatabaseUrl } from "../db/test/test-db";
import * as schema from "../db/schema";
import { createApp } from "./app";
import { FIXTURE_UPDATE, fixtureBus, publishFixtureUpdate } from "../txline/bus";
import {
  createPostgresFixtureBridge,
  FIXTURE_UPDATE_CHANNEL,
} from "../txline/postgres-bus";

// This integration test DB is shared with every other *.int.test.ts file in
// the same run, so other fixtures may already exist. Every test here reads
// *all* pending snapshot messages and picks out its own fixture by ID,
// rather than assuming its fixture is the only (or first) one sent.

const { fixtures } = schema;
const sql = postgres(testDatabaseUrl(), { max: 1 });
const db = drizzle(sql, { schema });

afterAll(async () => {
  await sql.end();
});

type SSEMessage = { event?: string; id?: string; data?: string };

function parseSSE(chunk: string): SSEMessage[] {
  return chunk
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      const message: SSEMessage = {};
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) message.event = line.slice("event: ".length);
        else if (line.startsWith("id: ")) message.id = line.slice("id: ".length);
        else if (line.startsWith("data: ")) message.data = line.slice("data: ".length);
      }
      return message;
    });
}

/** Reads from the stream until at least `count` fully-terminated SSE messages arrive. */
async function readMessages(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  count: number,
): Promise<SSEMessage[]> {
  const decoder = new TextDecoder();
  let buffer = "";
  const messages: SSEMessage[] = [];

  while (messages.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lastBoundary = buffer.lastIndexOf("\n\n");
    if (lastBoundary === -1) continue;
    const complete = buffer.slice(0, lastBoundary);
    buffer = buffer.slice(lastBoundary + 2);
    messages.push(...parseSSE(complete));
  }

  return messages;
}

async function countFixtureRows(): Promise<number> {
  const [row] = await sql<{ count: number }[]>`select count(*)::int as count from fixtures`;
  return row?.count ?? 0;
}

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

/** Reads every pending snapshot message and returns the one for `fixtureId`. */
async function readOwnSnapshot(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  fixtureId: string,
  totalRows: number,
): Promise<SSEMessage> {
  const messages = await readMessages(reader, totalRows);
  const own = messages.find((message) => message.id?.startsWith(`${fixtureId}:`));
  if (!own) throw new Error(`no snapshot found for fixture ${fixtureId}`);
  return own;
}

/** Advances a fixture's durable state and publishes it, mirroring what
 * applyTxLineEvent + toFixtureUpdate do together in production. */
async function advanceFixture(fixtureId: string, seq: number) {
  await db.update(fixtures).set({ lastSeq: seq, gameState: "live" }).where(eq(fixtures.id, fixtureId));
  publishFixtureUpdate({ fixtureId, seq, gameState: "live", stats: {} });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 500, intervalMs = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("waitUntil: condition never became true");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("GET /api/live", () => {
  it("sends the current snapshot first, then relays a newly applied event", async () => {
    const fixtureId = await insertFixture({ lastSeq: 0 });
    const totalRows = await countFixtureRows();

    const app = createApp({ db });
    const res = await app.request("/api/live");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    try {
      const snapshot = await readOwnSnapshot(reader, fixtureId, totalRows);
      expect(snapshot.event).toBe("snapshot");
      expect(snapshot.id).toBe(`${fixtureId}:0`);
      expect(JSON.parse(snapshot.data!)).toMatchObject({
        fixtureId,
        seq: 0,
        gameState: "scheduled",
      });

      // The listener is only registered once every snapshot row has been
      // sent, which readOwnSnapshot(reader, ..., totalRows) guarantees.
      publishFixtureUpdate({
        fixtureId,
        seq: 1,
        gameState: "live",
        stats: {
          full_time: {
            home: { goals: 1, yellowCards: 0, redCards: 0, corners: 0 },
            away: { goals: 0, yellowCards: 0, redCards: 0, corners: 0 },
          },
        },
      });

      const [update] = await readMessages(reader, 1);
      expect(update?.event).toBe("update");
      expect(update?.id).toBe(`${fixtureId}:1`);
      expect(JSON.parse(update!.data!)).toMatchObject({ fixtureId, seq: 1, gameState: "live" });
    } finally {
      await reader.cancel();
      await waitUntil(() => fixtureBus.listenerCount(FIXTURE_UPDATE) === 0).catch(() => {});
    }
  });

  it("reconnect with a stale Last-Event-ID still yields the correct current snapshot", async () => {
    const fixtureId = await insertFixture({ lastSeq: 2 });
    const totalRows = await countFixtureRows();

    const app = createApp({ db });
    const res = await app.request("/api/live", {
      headers: { "Last-Event-ID": `${fixtureId}:0` },
    });

    const reader = res.body!.getReader();
    try {
      const snapshot = await readOwnSnapshot(reader, fixtureId, totalRows);
      expect(snapshot.event).toBe("snapshot");
      expect(snapshot.id).toBe(`${fixtureId}:2`);
      expect(JSON.parse(snapshot.data!)).toMatchObject({ fixtureId, seq: 2 });
    } finally {
      await reader.cancel();
      await waitUntil(() => fixtureBus.listenerCount(FIXTURE_UPDATE) === 0).catch(() => {});
    }
  });

  it("reconnect after an update returns the new state, not a replayed duplicate", async () => {
    const fixtureId = await insertFixture({ lastSeq: 0 });
    const totalRows = await countFixtureRows();
    const listenersBefore = fixtureBus.listenerCount(FIXTURE_UPDATE);

    const app = createApp({ db });
    const res = await app.request("/api/live");
    const reader = res.body!.getReader();

    try {
      await readOwnSnapshot(reader, fixtureId, totalRows);

      await advanceFixture(fixtureId, 1);
      const [update] = await readMessages(reader, 1);
      expect(update?.id).toBe(`${fixtureId}:1`);
    } finally {
      await reader.cancel();
      await waitUntil(() => fixtureBus.listenerCount(FIXTURE_UPDATE) === listenersBefore);
    }

    // A later reconnect gets exactly the current snapshot (seq 1) once —
    // not seq 0 followed by a replayed seq 1 update.
    const reconnectTotalRows = await countFixtureRows();
    const reconnect = createApp({ db });
    const reconnectRes = await reconnect.request("/api/live");
    const reconnectReader = reconnectRes.body!.getReader();
    try {
      const snapshot = await readOwnSnapshot(reconnectReader, fixtureId, reconnectTotalRows);
      expect(snapshot.event).toBe("snapshot");
      expect(snapshot.id).toBe(`${fixtureId}:1`);
    } finally {
      await reconnectReader.cancel();
    }
  });

  it("cleans up the bus listener when the client disconnects", async () => {
    const fixtureId = await insertFixture({ lastSeq: 0 });
    const totalRows = await countFixtureRows();
    const listenersBefore = fixtureBus.listenerCount(FIXTURE_UPDATE);

    const app = createApp({ db });
    const res = await app.request("/api/live");
    const reader = res.body!.getReader();

    // The listener is registered before any snapshot row is sent (see
    // live.ts), so it's guaranteed to be there by the time this resolves.
    await readOwnSnapshot(reader, fixtureId, totalRows);
    expect(fixtureBus.listenerCount(FIXTURE_UPDATE)).toBe(listenersBefore + 1);

    await reader.cancel();
    await waitUntil(() => fixtureBus.listenerCount(FIXTURE_UPDATE) === listenersBefore);

    expect(fixtureBus.listenerCount(FIXTURE_UPDATE)).toBe(listenersBefore);
  });

  it("relays a validated Postgres notification from the separate runner process", async () => {
    const fixtureId = await insertFixture({ lastSeq: 0 });
    const totalRows = await countFixtureRows();
    const app = createApp({
      db,
      fixtureNotifications: createPostgresFixtureBridge({
        createClient: () => postgres(testDatabaseUrl(), { max: 1 }),
      }),
    });
    const res = await app.request("/api/live");
    const reader = res.body!.getReader();

    try {
      await readOwnSnapshot(reader, fixtureId, totalRows);
      const update = { fixtureId, seq: 1, gameState: "live" as const, stats: {} };
      await db
        .update(fixtures)
        .set({ lastSeq: 1, gameState: "live" })
        .where(eq(fixtures.id, fixtureId));
      await sql.notify(FIXTURE_UPDATE_CHANNEL, JSON.stringify(update));

      const [message] = await readMessages(reader, 1);
      expect(message?.event).toBe("update");
      expect(message?.id).toBe(`${fixtureId}:1`);
      expect(JSON.parse(message!.data!)).toEqual(update);
    } finally {
      await reader.cancel();
    }
  });

  it("closes SSE on bridge reconnect, heals from snapshot, and releases the final listener", async () => {
    const fixtureId = await insertFixture({ lastSeq: 0 });
    const totalRows = await countFixtureRows();
    const listenersBefore = fixtureBus.listenerCount(FIXTURE_UPDATE);
    let reconnect: (() => void) | undefined;
    const unlisten = vi.fn(async () => {});
    const end = vi.fn(async () => {});
    const createClient = vi.fn(() => ({
      listen: vi.fn(
        async (
          _channel: string,
          _onNotify: (payload: string) => void,
          onListen?: () => void,
        ) => {
          reconnect = onListen;
          onListen?.();
          return { unlisten };
        },
      ),
      end,
    }));
    const app = createApp({
      db,
      fixtureNotifications: createPostgresFixtureBridge({ createClient }),
    });
    const firstResponse = await app.request("/api/live");
    const secondResponse = await app.request("/api/live");
    const firstReader = firstResponse.body!.getReader();
    const secondReader = secondResponse.body!.getReader();

    await readOwnSnapshot(firstReader, fixtureId, totalRows);
    await readOwnSnapshot(secondReader, fixtureId, totalRows);
    expect(createClient).toHaveBeenCalledOnce();

    await firstReader.cancel();
    await waitUntil(
      () => fixtureBus.listenerCount(FIXTURE_UPDATE) === listenersBefore + 1,
    );
    expect(unlisten).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();

    const secondClosed = secondReader.read();
    reconnect?.();
    expect(await secondClosed).toMatchObject({ done: true });
    await waitUntil(() => unlisten.mock.calls.length === 1 && end.mock.calls.length === 1);

    await db
      .update(fixtures)
      .set({ lastSeq: 2, gameState: "live" })
      .where(eq(fixtures.id, fixtureId));

    const reconnectResponse = await app.request("/api/live");
    const reconnectReader = reconnectResponse.body!.getReader();
    const healed = await readOwnSnapshot(reconnectReader, fixtureId, totalRows);
    expect(healed.id).toBe(`${fixtureId}:2`);
    expect(JSON.parse(healed.data!)).toMatchObject({ fixtureId, seq: 2 });
    expect(createClient).toHaveBeenCalledTimes(2);

    await reconnectReader.cancel();
    await waitUntil(() => unlisten.mock.calls.length === 2 && end.mock.calls.length === 2);
    await waitUntil(() => fixtureBus.listenerCount(FIXTURE_UPDATE) === listenersBefore);
  });
});
