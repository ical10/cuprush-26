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
  app.get("/app", serveStatic({ path: "./dist/client/app.html" }));
  app.get("/app/*", serveStatic({ path: "./dist/client/app.html" }));
  app.get(
    "/cuprush-litepaper",
    serveStatic({ path: "./dist/client/cuprush-litepaper.pdf" }),
  );
  // Built assets are content-hashed, so they can be cached forever. Without
  // this the server sends no Cache-Control at all and clients revalidate on
  // heuristics — deadly for the runtime-cached Privy chunk.
  app.use(
    "/assets/*",
    serveStatic({
      root: "./dist/client",
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  app.use("/*", serveStatic({ root: "./dist/client" }));
  // An /api path reaching this point matched no route — that's a 404, not
  // the landing page. Same for anything that looks like a file (dot in the
  // last segment): a missing asset must fail loudly, not return HTML 200.
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
  const landingFallback = serveStatic({ path: "./dist/client/index.html" });
  app.get("*", async (c, next) => {
    const lastSegment = c.req.path.split("/").pop() ?? "";
    if (lastSegment.includes(".")) {
      return c.notFound();
    }
    return (await landingFallback(c, next)) ?? c.notFound();
  });
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
