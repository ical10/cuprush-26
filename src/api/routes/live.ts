import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { fixtures } from "../../db/schema";
import { onFixtureUpdate, type FixtureUpdate } from "../../txline/bus";
import type { DbProvider } from "../auth/middleware";

const HEARTBEAT_MS = 25_000;

function eventId(fixtureId: string, seq: number): string {
  return `${fixtureId}:${seq}`;
}

function snapshotPayload(row: typeof fixtures.$inferSelect): FixtureUpdate {
  return {
    fixtureId: row.id,
    seq: row.lastSeq,
    gameState: row.gameState,
    stats: row.stats,
  };
}

/**
 * GET /live — snapshot-first, reconnect-safe SSE relay.
 *
 * On (re)connect, sends every fixture's current state first (this alone
 * satisfies Last-Event-ID: a reconnecting client always gets state at least
 * as new as anything it already saw — no event log to replay from). Then
 * relays applied fixture updates from the in-process bus as they happen.
 */
export function createLiveRoute(getDb: DbProvider) {
  return new Hono().get("/live", (c) => {
    return streamSSE(c, async (stream) => {
      // Everything below is registered synchronously, before any `await`:
      // - the bus listener, so an update published while the snapshot loop
      //   is still running is never missed;
      // - onAbort, because StreamingApi.onAbort() only calls a listener
      //   registered *before* abort() has already run — a listener added
      //   after the client disconnects would silently never fire.
      const unsubscribe = onFixtureUpdate((update: FixtureUpdate) => {
        void stream.writeSSE({
          event: "update",
          id: eventId(update.fixtureId, update.seq),
          data: JSON.stringify(update),
        });
      });

      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let resolveDone: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const cleanup = () => {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        resolveDone();
      };
      stream.onAbort(cleanup);

      try {
        const db = await getDb();
        const rows = await db.select().from(fixtures);
        for (const row of rows) {
          await stream.writeSSE({
            event: "snapshot",
            id: eventId(row.id, row.lastSeq),
            data: JSON.stringify(snapshotPayload(row)),
          });
        }

        heartbeat = setInterval(() => {
          void stream.write(": heartbeat\n\n");
        }, HEARTBEAT_MS);

        await done;
      } finally {
        cleanup();
      }
    });
  });
}
