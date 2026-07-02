import type { Database } from "../db/client";
import { fixtures } from "../db/schema";
import { applyTxLineEvent, toFixtureUpdate } from "./apply";
import { publishFixtureUpdate } from "./bus";
import { txLineEventSchema, txLineFixtureListSchema } from "./schema";
import type { TxLineClient } from "./client";

/**
 * Live mode: connects to the real TxLINE snapshot + stream endpoints.
 *
 * No TxLINE credentials exist yet, so the HTTP specifics here are a best
 * guess at the documented shape (fetch a snapshot on (re)connect, then
 * consume a newline-delimited JSON stream) and are deliberately isolated in
 * this one file — adjust readLiveConfig/fetchSnapshot/streamEvents once a
 * real endpoint is available. Nothing else in the codebase depends on this
 * shape; everything downstream only sees validated TxLineEvent objects.
 */

export type TxLineLiveConfig = {
  baseUrl: string;
  apiKey: string;
};

export function readLiveConfig(env: NodeJS.ProcessEnv): TxLineLiveConfig {
  const baseUrl = env.TXLINE_BASE_URL;
  const apiKey = env.TXLINE_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "TXLINE_BASE_URL and TXLINE_API_KEY are required when TXLINE_MODE=live",
    );
  }
  return { baseUrl, apiKey };
}

async function fetchSnapshot(config: TxLineLiveConfig, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(new URL("/snapshot", config.baseUrl), {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal,
  });
  if (!res.ok) {
    throw new Error(`TxLINE snapshot request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Newline-delimited JSON stream of raw (unvalidated) TxLINE events. */
async function* streamEvents(
  config: TxLineLiveConfig,
  signal: AbortSignal,
): AsyncGenerator<unknown> {
  const res = await fetch(new URL("/stream", config.baseUrl), {
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`TxLINE stream request failed: ${res.status} ${res.statusText}`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) yield JSON.parse(line);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export type LiveClientOptions = {
  db: Database;
  env: NodeJS.ProcessEnv;
};

export function createLiveTxLineClient(options: LiveClientOptions): TxLineClient {
  const config = readLiveConfig(options.env);
  let controller: AbortController | null = null;
  let loop: Promise<void> | null = null;

  async function seedSnapshot(signal: AbortSignal): Promise<void> {
    const raw = await fetchSnapshot(config, signal);
    const snapshots = txLineFixtureListSchema.parse(raw);
    for (const snapshot of snapshots) {
      await options.db
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
  }

  async function run(signal: AbortSignal): Promise<void> {
    // Reconnect fetches a snapshot before resuming the stream.
    await seedSnapshot(signal);

    for await (const raw of streamEvents(config, signal)) {
      if (signal.aborted) return;
      const event = txLineEventSchema.safeParse(raw);
      if (!event.success) {
        console.error("Discarding invalid TxLINE event", event.error.message);
        continue;
      }
      const outcome = await applyTxLineEvent(options.db, event.data);
      if (outcome.applied) {
        publishFixtureUpdate(toFixtureUpdate(outcome.fixture));
      }
    }
  }

  return {
    async start() {
      controller = new AbortController();
      loop = run(controller.signal).catch((error) => {
        if (controller?.signal.aborted) return;
        console.error("TxLINE live client stopped unexpectedly", error);
      });
    },
    async stop() {
      controller?.abort();
      await loop?.catch(() => {});
      controller = null;
      loop = null;
    },
  };
}
