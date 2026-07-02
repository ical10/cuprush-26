import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { createApp } from "./app";
import { db } from "../db/client";
import { createTxLineClient } from "../txline/client";
import { createQuestionScheduler } from "../questions/scheduler";

const app = createApp();

if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist/client" }));
  app.get("*", serveStatic({ path: "./dist/client/index.html" }));
}

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`world-cup-hilo api listening on http://localhost:${info.port}`);
});

// Backend owns the one TxLINE stream for the whole process (replay by
// default; TXLINE_MODE=live once credentials exist).
const txLineClient = createTxLineClient({
  db,
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
