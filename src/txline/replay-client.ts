import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "../db/client";
import { fixtures } from "../db/schema";
import { applyTxLineEvent, toFixtureUpdate } from "./apply";
import { publishFixtureUpdate, type FixtureUpdatePublisher } from "./bus";
import { txLineReplayFileSchema, type TxLineReplayFile } from "./schema";
import type { TxLineClient } from "./client";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURES_DIR = path.join(here, "fixtures", "samples");

export type ReplayClientOptions = {
  db: Database;
  /** Directory of captured JSON event files. Defaults to fixtures/samples. */
  fixturesDir?: string;
  /**
   * Delay between events in ms. 0 (default) applies every event immediately
   * ("on-demand" — used by tests). A positive value spaces events out on a
   * timer for a more realistic demo.
   */
  intervalMs?: number;
  publishUpdate?: FixtureUpdatePublisher;
};

export async function loadReplayFixtures(fixturesDir: string): Promise<TxLineReplayFile[]> {
  const entries = await readdir(fixturesDir);
  const files = entries.filter((entry) => entry.endsWith(".json")).sort();

  const parsed: TxLineReplayFile[] = [];
  for (const file of files) {
    const raw = await readFile(path.join(fixturesDir, file), "utf8");
    parsed.push(txLineReplayFileSchema.parse(JSON.parse(raw)));
  }
  return parsed;
}

async function seedSnapshot(db: Database, snapshot: TxLineReplayFile["snapshot"]): Promise<void> {
  await db
    .insert(fixtures)
    .values({
      id: snapshot.fixtureId,
      homeTeam: snapshot.homeTeam,
      awayTeam: snapshot.awayTeam,
      startsAt: new Date(snapshot.startsAt),
      gameState: snapshot.gameState,
      lastSeq: snapshot.seq,
      stats: snapshot.stats,
    })
    .onConflictDoNothing({ target: fixtures.id });
}

/** Replay mode: streams captured JSON fixture files on a timer or on-demand. */
export function createReplayTxLineClient(options: ReplayClientOptions): TxLineClient {
  const fixturesDir = options.fixturesDir ?? DEFAULT_FIXTURES_DIR;
  const intervalMs = options.intervalMs ?? 0;
  const publishUpdate = options.publishUpdate ?? publishFixtureUpdate;
  const timers: NodeJS.Timeout[] = [];
  let stopped = false;
  let files: TxLineReplayFile[] | undefined;
  let eventsApplied = false;
  let detachAbort: (() => void) | undefined;
  const noFailure = new Promise<Error>(() => {});

  async function applyEvent(event: TxLineReplayFile["events"][number]): Promise<void> {
    if (stopped) return;
    const outcome = await applyTxLineEvent(options.db, event);
    if (outcome.applied) {
      await publishUpdate(toFixtureUpdate(outcome.fixture));
    }
  }

  return {
    async prepare(signal) {
      stopped = false;
      signal?.throwIfAborted();
      files = await loadReplayFixtures(fixturesDir);

      for (const file of files) {
        signal?.throwIfAborted();
        await seedSnapshot(options.db, file.snapshot);
      }

      if (intervalMs <= 0) {
        for (const file of files) {
          for (const event of file.events) {
            signal?.throwIfAborted();
            await applyEvent(event);
          }
        }
        eventsApplied = true;
      }
    },
    async start(signal) {
      if (!files) await this.prepare(signal);
      signal?.throwIfAborted();
      const preparedFiles = files ?? [];
      const abort = () => {
        stopped = true;
        for (const timer of timers) clearTimeout(timer);
        timers.length = 0;
      };
      signal?.addEventListener("abort", abort, { once: true });
      detachAbort = () => signal?.removeEventListener("abort", abort);

      if (eventsApplied) return;

      for (const file of preparedFiles) {

        file.events.forEach((event, index) => {
          const timer = setTimeout(() => void applyEvent(event), (index + 1) * intervalMs);
          timers.push(timer);
        });
      }
    },
    waitForFailure() {
      return noFailure;
    },
    async stop() {
      stopped = true;
      detachAbort?.();
      detachAbort = undefined;
      for (const timer of timers) clearTimeout(timer);
      timers.length = 0;
      files = undefined;
      eventsApplied = false;
    },
  };
}
