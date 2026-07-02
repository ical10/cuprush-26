import type { Database } from "../db/client";
import { createReplayTxLineClient } from "./replay-client";
import { createLiveTxLineClient } from "./live-client";

export type TxLineMode = "replay" | "live";

export interface TxLineClient {
  start(): Promise<void>;
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
};

/** Picks the replay or live TxLINE client by TXLINE_MODE (default: replay). */
export function createTxLineClient(options: CreateTxLineClientOptions): TxLineClient {
  const mode = options.mode ?? txLineMode(options.env ?? process.env);

  if (mode === "live") {
    return createLiveTxLineClient({ db: options.db, env: options.env ?? process.env });
  }

  return createReplayTxLineClient({
    db: options.db,
    fixturesDir: options.fixturesDir,
    intervalMs: options.intervalMs,
  });
}
