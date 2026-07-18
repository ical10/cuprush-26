import { PrivyClient } from "@privy-io/server-auth";
import { and, eq, isNull } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import type { Database } from "../db/client";
import { agentCohorts, agents, participants } from "../db/schema";
import { generateCohortToken } from "./token";

/**
 * Provisions Privy server wallets for seeded agents and mints the cohort
 * bearer token.
 *
 * The Privy client boundary is injected as `createWallet` so the whole flow is
 * testable without live credentials. The default CLI wires the real Privy
 * server-auth client via {@link createPrivyWalletCreator}, which fails closed
 * when its credentials are absent.
 */

// The wallet-creation boundary. Returns only the durable identifiers we
// persist: the Privy wallet id and its Solana address.
export type WalletCreator = (input: {
  agentKey: string;
  idempotencyKey: string;
}) => Promise<{ walletId: string; address: string }>;

export type ProvisionSummary = {
  environment: string;
  walletsCreated: number;
  alreadyProvisioned: number;
  activated: number;
  tokenIssued: boolean;
};

// Deployment environment used to namespace idempotency keys, so a `dev`
// provisioning run can never collide with a `production` one.
export function resolveProvisionEnv(env: NodeJS.ProcessEnv = process.env): string {
  return env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || "dev";
}

// Stable per-agent idempotency key: re-running provisioning asks Privy for the
// same wallet rather than minting a duplicate.
export function deriveIdempotencyKey(
  environment: string,
  agentKey: string,
): string {
  return `hilo-${environment}-${agentKey}`;
}

/**
 * Builds a {@link WalletCreator} backed by the real Privy server-auth client.
 * Creating a server wallet is an authorized wallet-API request, so it needs
 * the app's authorization private key in addition to the app credentials.
 * Fails closed with a precise message listing any missing variable.
 */
export function createPrivyWalletCreator(
  env: NodeJS.ProcessEnv = process.env,
): WalletCreator {
  const appId = env.PRIVY_APP_ID;
  const appSecret = env.PRIVY_APP_SECRET;
  const authorizationKey = env.PRIVY_AUTHORIZATION_KEY;

  if (!appId || !appSecret || !authorizationKey) {
    const missing: string[] = [];
    if (!appId) missing.push("PRIVY_APP_ID");
    if (!appSecret) missing.push("PRIVY_APP_SECRET");
    if (!authorizationKey) missing.push("PRIVY_AUTHORIZATION_KEY");
    throw new Error(
      `provision:agents cannot create Privy wallets without ${missing.join(
        ", ",
      )}. Set them (PRIVY_AUTHORIZATION_KEY is the app authorization keypair's ` +
        "private key from the Privy dashboard) and re-run.",
    );
  }

  const client = new PrivyClient(appId, appSecret, {
    walletApi: { authorizationPrivateKey: authorizationKey },
  });

  return async ({ idempotencyKey }) => {
    const wallet = await client.walletApi.createWallet({
      chainType: "solana",
      idempotencyKey,
    });
    return { walletId: wallet.id, address: wallet.address };
  };
}

const TOKEN_BANNER =
  "================================================================\n" +
  "  COHORT BEARER TOKEN — store this now, it will NOT be shown again\n" +
  "================================================================";

/**
 * For every seeded agent still missing a Privy wallet: create one, record the
 * wallet id and (first-write-wins) the participant's wallet address, then flip
 * the agent seeded -> active. Once all agents are handled, mint the cohort
 * bearer token if the cohort has none, printing the plaintext exactly once.
 */
export async function provisionAgents(opts: {
  db: Database;
  createWallet: WalletCreator;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}): Promise<ProvisionSummary> {
  const { db: database, createWallet } = opts;
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((message: string) => console.log(message));
  const environment = resolveProvisionEnv(env);

  const pending = await database
    .select({
      participantId: agents.participantId,
      agentKey: agents.agentKey,
    })
    .from(agents)
    .where(isNull(agents.privyWalletId));

  const provisionedAlready = await database
    .select({ participantId: agents.participantId })
    .from(agents);
  const alreadyProvisioned = provisionedAlready.length - pending.length;

  let walletsCreated = 0;
  let activated = 0;

  for (const agent of pending) {
    const { walletId, address } = await createWallet({
      agentKey: agent.agentKey,
      idempotencyKey: deriveIdempotencyKey(environment, agent.agentKey),
    });

    // Record the wallet id first, only while the slot is still empty.
    await database
      .update(agents)
      .set({ privyWalletId: walletId })
      .where(
        and(
          eq(agents.participantId, agent.participantId),
          isNull(agents.privyWalletId),
        ),
      );
    walletsCreated += 1;

    // Mirror the /wallet route: first-write-wins on the participant address.
    await database
      .update(participants)
      .set({ walletAddress: address })
      .where(
        and(
          eq(participants.id, agent.participantId),
          isNull(participants.walletAddress),
        ),
      );

    // Activate only after the wallet mapping is fully written.
    const flipped = await database
      .update(agents)
      .set({ status: "active" })
      .where(
        and(
          eq(agents.participantId, agent.participantId),
          eq(agents.status, "seeded"),
        ),
      )
      .returning({ participantId: agents.participantId });
    if (flipped.length > 0) activated += 1;
  }

  // Mint the cohort token(s) after all agents are provisioned. The seed makes
  // a single cohort, but we handle each distinct cohort defensively.
  const cohortIds = await database
    .selectDistinct({ cohortId: agents.cohortId })
    .from(agents);

  let tokenIssued = false;
  for (const { cohortId } of cohortIds) {
    const [cohort] = await database
      .select({ tokenHash: agentCohorts.tokenHash })
      .from(agentCohorts)
      .where(eq(agentCohorts.id, cohortId))
      .limit(1);
    if (!cohort) continue;

    if (cohort.tokenHash) {
      log(
        `Cohort ${cohortId} already has a bearer token; rotation is a ` +
          "separate manual step and no token was printed.",
      );
      continue;
    }

    const { token, hash } = generateCohortToken();
    // Conditional write: only claim the slot while it is still empty.
    const [updated] = await database
      .update(agentCohorts)
      .set({ tokenHash: hash })
      .where(and(eq(agentCohorts.id, cohortId), isNull(agentCohorts.tokenHash)))
      .returning({ id: agentCohorts.id });

    if (updated) {
      log(TOKEN_BANNER);
      log(`  cohort: ${cohortId}`);
      log(`  token:  ${token}`);
      log("================================================================");
      tokenIssued = true;
    }
  }

  return {
    environment,
    walletsCreated,
    alreadyProvisioned,
    activated,
    tokenIssued,
  };
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  // Import the DB client lazily so importing this module for its pure helpers
  // (e.g. from unit tests) never requires DATABASE_URL.
  const { db, queryClient } = await import("../db/client");
  const createWallet = createPrivyWalletCreator(process.env);
  provisionAgents({ db, createWallet, env: process.env })
    .then((summary) => {
      console.log(
        `provision:agents (${summary.environment}) — wallets created ` +
          `${summary.walletsCreated}, already provisioned ` +
          `${summary.alreadyProvisioned}, activated ${summary.activated}, ` +
          `token ${summary.tokenIssued ? "issued" : "unchanged"}`,
      );
    })
    .catch((error: unknown) => {
      console.error("provision:agents failed", error);
      process.exitCode = 1;
    })
    .finally(() => {
      void queryClient.end({ timeout: 5 });
    });
}
