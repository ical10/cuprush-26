import { Hono } from "hono";
import { healthRoute } from "./routes/health";
import { createLiveRoute, type DbProvider } from "./routes/live";
import type { Database } from "../db/client";

export type CreateAppOptions = {
  db?: Database;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = new Hono();

  // The production db (src/db/client.ts) throws at import time if
  // DATABASE_URL is unset, so when no db is supplied it's only imported
  // lazily, inside a live request — unit tests that build an app without
  // ever calling /api/live (e.g. health.test.ts) keep working with no
  // database configured at all.
  const getDb: DbProvider = options.db
    ? () => options.db as Database
    : async () => (await import("../db/client")).db;

  app.route("/api", healthRoute);
  app.route("/api", createLiveRoute(getDb));

  return app;
}
