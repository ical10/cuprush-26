import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app";
import { db, queryClient } from "../db/client";
import { createChainAdapterFromEnv } from "../chain";
import { createTxLineClient } from "../txline/client";
import { createQuestionScheduler } from "../questions/scheduler";
import { createSettlementExecutor } from "../questions/settle";
import { createPredictionReconciler } from "../predictions/reconciler";

// One chain adapter for the whole process: the prediction routes and the
// reconciler must share it (the stub's state is in-memory).
const chain = createChainAdapterFromEnv();

const app = createApp({ chain });

// Serve the built client whenever it exists (production, or a local
// production-ish smoke run with the dev auth stub). The /api routes were
// registered first, so they always win.
if (existsSync("./dist/client")) {
  app.use("/*", serveStatic({ root: "./dist/client" }));
  app.get("*", serveStatic({ path: "./dist/client/index.html" }));
}

const port = Number(process.env.PORT ?? 3000);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`cuprush-26 api listening on http://localhost:${info.port}`);
});

// Backend owns the one TxLINE stream for the whole process (replay by
// default; TXLINE_MODE=live once credentials exist).
const txLineClient = createTxLineClient({
  db,
  // Replay-mode knobs: an alternate captured-fixtures directory (used by the
  // README smoke test) and the ms between replayed events.
  fixturesDir: process.env.TXLINE_FIXTURES_DIR,
  intervalMs: Number(process.env.TXLINE_REPLAY_INTERVAL_MS ?? 1500),
});
txLineClient.start().catch((error: unknown) => {
  console.error("Failed to start TxLINE client", error);
});

// Question lifecycle scheduler: scheduled->open->locked by time (1-minute
// tick), live->settling->void from fixture bus events. LLM_SELECTOR/
// OPENROUTER_API_KEY (issue 5) gate the secondary-card LLM selector; off by
// default, always falls back to the deterministic template path.
const questionScheduler = createQuestionScheduler({ db });
questionScheduler.start();

// One-minute prediction reconciler: retries pending chain submissions with
// capped backoff, repairs rows whose prediction already reached the chain,
// and fails pending rows once their question locks.
const predictionReconciler = createPredictionReconciler({ db, adapter: chain });
predictionReconciler.start();

// One-minute settlement executor: moves "settling" questions to "settled"
// (evaluating outcomes from fixture stats, submitting to chain) and scores
// their confirmed predictions exactly once.
const settlementExecutor = createSettlementExecutor({ db, chain });
settlementExecutor.start();

// Graceful shutdown: stop the background loops, then the HTTP server, then
// the DB pool. Idempotent so a second signal doesn't double-close.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  questionScheduler.stop();
  predictionReconciler.stop();
  settlementExecutor.stop();
  await txLineClient.stop().catch(() => {});
  server.close();
  await queryClient.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
