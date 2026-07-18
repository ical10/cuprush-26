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
import { parseAppRuntimeMode } from "./runtime-mode";

// One chain adapter for the whole process, shared by the reconciler and the
// settlement executor (the stub's state is in-memory). The request routes no
// longer touch chain — the reconciler is the single commit path.
const chain = createChainAdapterFromEnv();

const app = createApp();

// Serve the built client whenever it exists (production, or a local
// production-ish smoke run with the dev auth stub). The /api routes were
// registered first, so they always win.
if (existsSync("./dist/client")) {
  app.use("/*", serveStatic({ root: "./dist/client" }));
  app.get("*", serveStatic({ path: "./dist/client/index.html" }));
}

const port = Number(process.env.PORT ?? 3000);
const appRuntimeMode = parseAppRuntimeMode();

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`cuprush-26 api listening on http://localhost:${info.port}`);
  console.log(`APP_RUNTIME_MODE=${appRuntimeMode}`);
});

function startBackgroundComponents() {
  const txLineClient = createTxLineClient({
    db,
    fixturesDir: process.env.TXLINE_FIXTURES_DIR,
    intervalMs: Number(process.env.TXLINE_REPLAY_INTERVAL_MS ?? 1500),
  });
  txLineClient.start().catch((error: unknown) => {
    console.error("Failed to start TxLINE client", error);
  });

  const questionScheduler = createQuestionScheduler({ db });
  questionScheduler.start();

  const predictionReconciler = createPredictionReconciler({ db, adapter: chain });
  predictionReconciler.start();

  const settlementExecutor = createSettlementExecutor({ db, chain });
  settlementExecutor.start();

  return {
    txLineClient,
    questionScheduler,
    predictionReconciler,
    settlementExecutor,
  };
}

const backgroundComponents =
  appRuntimeMode === "full" ? startBackgroundComponents() : undefined;

// Graceful shutdown: stop the background loops, then the HTTP server, then
// the DB pool. Idempotent so a second signal doesn't double-close.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  backgroundComponents?.questionScheduler.stop();
  backgroundComponents?.predictionReconciler.stop();
  backgroundComponents?.settlementExecutor.stop();
  await backgroundComponents?.txLineClient.stop().catch(() => {});
  server.close();
  await queryClient.end({ timeout: 5 }).catch(() => {});
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
