import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { z } from "zod";
import type { DbProvider } from "../auth/middleware";
import type { Database } from "../../db/client";
import {
  authenticateCohort,
  cohortBearerToken,
  decisionItemSchema,
  getPendingWork,
  submitDecisions,
  type CohortRow,
} from "./cohort";

const GET_PENDING_WORK_DESCRIPTION =
  "Returns the authenticated cohort's active AI players and the work waiting " +
  "for each: persona, strategy, a short recent-form history (last ~10 settled " +
  "picks — template, the player's own outcome, and whether it landed), and the " +
  "open questions the player has not answered yet. Questions within 2 minutes " +
  "of their lock time are omitted, because submissions are refused inside that " +
  "margin. Takes no arguments. Call this to decide what to submit, then call " +
  "submit_decisions.";

const SUBMIT_DECISIONS_DESCRIPTION =
  "Submits one or more predictions on behalf of the cohort's players. " +
  "`agent_key` is bound to a player server-side from the authenticated cohort " +
  "— you cannot predict for another cohort's agent (such items return " +
  "`unknown_agent`). Each decision is validated and stored independently: one " +
  "bad item never rejects the others, and the response is a per-item results " +
  "array (`{ ok: true, predictionId }` or `{ ok: false, error }`). Resubmitting " +
  "the same (agent, question) is idempotent — it returns the existing " +
  "prediction, never a duplicate. A question within 2 minutes of its lock is " +
  "rejected with error `locked`. `confidence` is 0..1; `rationale` is at most " +
  "280 characters.";

/**
 * Builds a fresh MCP server exposing the two cohort tools. The authenticated
 * cohort is captured in the closure, so `agent_key` attribution and the
 * player set are always decided from the token, never from tool input. A new
 * server is built per request (stateless transport), so nothing here is
 * shared between cohorts.
 */
function buildCohortMcpServer(db: Database, cohort: CohortRow): McpServer {
  const server = new McpServer({ name: "cuprush-cohort", version: "1.0.0" });

  server.registerTool(
    "get_pending_work",
    { description: GET_PENDING_WORK_DESCRIPTION, inputSchema: {} },
    async () => {
      const result = await getPendingWork(db, cohort);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    "submit_decisions",
    {
      description: SUBMIT_DECISIONS_DESCRIPTION,
      inputSchema: { decisions: z.array(decisionItemSchema) },
    },
    async ({ decisions }) => {
      const result = await submitDecisions(db, cohort, decisions);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    },
  );

  return server;
}

/**
 * Streamable-HTTP MCP transport for the cohort tools, mounted at
 * `POST /api/cohort/mcp`. The same cohort bearer token that guards the REST
 * routes is checked here first — an invalid, unknown, or non-active token is
 * rejected before any MCP processing. Requests are stateless: each one spins
 * up its own transport + server (no session bookkeeping), bridged from Hono's
 * Web-standard `Request`/`Response` via the SDK's Web-standard transport.
 */
export function createCohortMcpRoute(getDb: DbProvider) {
  const app = new Hono();

  app.on(["POST", "GET", "DELETE"], "/cohort/mcp", async (c) => {
    const db = await getDb();
    const auth = await authenticateCohort(
      db,
      cohortBearerToken(c.req.header("Authorization")),
    );
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const server = buildCohortMcpServer(db, auth.cohort);
    await server.connect(transport);

    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void transport.close();
      void server.close();
    }
  });

  return app;
}
