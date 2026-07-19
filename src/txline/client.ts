import type { Database } from "../db/client";
import type { FixtureUpdatePublisher } from "./bus";
import { createReplayTxLineClient } from "./replay-client";
import { createLiveTxLineClient } from "./live-client";

export type TxLineMode = "replay" | "live";

export interface TxLineClient {
  /** Discovers fixtures without fetching per-fixture scores or opening the stream. */
  prepare(signal?: AbortSignal): Promise<void>;
  /** Applies score snapshots and opens the event stream. */
  start(signal?: AbortSignal): Promise<void>;
  /** Resolves only when a background live stream exhausts its reconnect budget. */
  waitForFailure(): Promise<Error>;
  stop(): Promise<void>;
}

export function txLineMode(env: NodeJS.ProcessEnv = process.env): TxLineMode {
  return env.TXLINE_MODE === "live" ? "live" : "replay";
}

export type CreateTxLineClientOptions = {
  db: Database;
  mode?: TxLineMode;
  env?: NodeJS.ProcessEnv;
  fixturesDir?: string;
  intervalMs?: number;
  publishUpdate?: FixtureUpdatePublisher;
};

/** Picks the replay or live TxLINE client by TXLINE_MODE (default: replay). */
export function createTxLineClient(options: CreateTxLineClientOptions): TxLineClient {
  const mode = options.mode ?? txLineMode(options.env ?? process.env);

  if (mode === "live") {
    return createLiveTxLineClient({
      db: options.db,
      env: options.env ?? process.env,
      publishUpdate: options.publishUpdate,
    });
  }

  return createReplayTxLineClient({
    db: options.db,
    env: options.env ?? process.env,
    fixturesDir: options.fixturesDir,
    intervalMs: options.intervalMs,
    publishUpdate: options.publishUpdate,
  });
}
