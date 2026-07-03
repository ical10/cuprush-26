import { Hono } from "hono";
import { healthRoute } from "./routes/health";
import { createLiveRoute, type DbProvider } from "./routes/live";
import { createAccountRoutes } from "./routes/account";
import { createLeaderboardRoute } from "./routes/leaderboard";
import { createAuthAdapterFromEnv, type AuthAdapter } from "./auth/adapter";
import type { Database } from "../db/client";

export type CreateAppOptions = {
  db?: Database;
  auth?: AuthAdapter;
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

  // AUTH_MODE=privy verifies real Privy tokens; the dev stub is the default
  // and refuses to start when NODE_ENV=production.
  const auth = options.auth ?? createAuthAdapterFromEnv();

  app.route("/api", healthRoute);
  app.route("/api", createLiveRoute(getDb));
  app.route("/api", createAccountRoutes(getDb, auth));
  app.route("/api", createLeaderboardRoute(getDb));

  return app;
}
