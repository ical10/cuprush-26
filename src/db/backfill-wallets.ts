import { and, eq, isNull } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { PrivyClient } from "@privy-io/server-auth";
import type {
  LinkedAccountWithMetadata,
  WalletWithMetadata,
} from "@privy-io/server-auth";
import type { Database } from "./client";
import { participants, users } from "./schema";
import { walletSchema } from "../api/routes/account";

/**
 * One-off backfill for accounts created while the client was missing Privy's
 * Solana connectors (see privy-provider.tsx `externalWallets`): embedded
 * Solana wallet creation silently no-oped at login, leaving human participants
 * with a linked Privy user but wallet_address NULL. Privy only auto-creates
 * wallets at login time (`createOnLogin`), so existing signed-in sessions stay
 * walletless until this backfill runs.
 *
 * For each stuck user: fetch the Privy user by DID; if an embedded Solana
 * wallet already exists in linkedAccounts (client just never saved it), take
 * its address; otherwise create one server-side via
 * `PrivyClient.createWallets({ userId, createSolanaWallet: true })`. The
 * address is saved with the same first-write-wins semantics as POST /wallet: a
 * conditional update that only claims the slot while it is still empty, with
 * unique violations (address claimed elsewhere) logged as warnings, never
 * crashing the run.
 *
 * Dry-run by default: reads from Privy and the DB but writes nothing (no
 * wallet creation either). Set BACKFILL_CONFIRM=yes to execute. Idempotent: a
 * participant whose wallet_address is filled is never selected again.
 *
 * Logs one JSON line per user (privyUserId, action, address). Never logs
 * tokens or secrets.
 */

// Minimal read surface of the Privy user object this backfill needs, so the
// gateway can be faked in tests without live credentials.
export type PrivyUserAccounts = {
  linkedAccounts: LinkedAccountWithMetadata[];
};

export type PrivyGateway = {
  getUser(privyUserId: string): Promise<PrivyUserAccounts>;
  createSolanaWallet(privyUserId: string): Promise<PrivyUserAccounts>;
};

// Same filtering semantics as the client's embeddedSolanaAddress
// (src/web/auth/privy-provider.tsx): the Privy-created embedded Solana wallet,
// not any external linked wallet.
export function embeddedSolanaAddress(
  linkedAccounts: readonly LinkedAccountWithMetadata[],
): string | null {
  const wallet = linkedAccounts.find(
    (account): account is WalletWithMetadata =>
      account.type === "wallet" &&
      account.chainType === "solana" &&
      (account.walletClientType === "privy" ||
        account.walletClientType === "privy-v2"),
  );
  return wallet?.address ?? null;
}

// Postgres unique_violation, possibly wrapped in a DrizzleQueryError whose
// `cause` carries the original postgres-js error (same as POST /wallet).
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

type BackfillAction =
  | "found-existing"
  | "created"
  | "would-create"
  | "skipped-already-filled"
  | "skipped-address-taken"
  | "skipped-invalid-address"
  | "skipped-privy-error";

export type BackfillSummary = {
  scanned: number;
  foundExisting: number;
  created: number;
  saved: number;
  skipped: number;
  failures: number;
  confirmed: boolean;
};

function logLine(entry: {
  privyUserId: string;
  action: BackfillAction;
  address: string | null;
}): void {
  console.log(JSON.stringify(entry));
}

export async function backfillWallets(
  db: Database,
  privy: PrivyGateway,
  options: { confirm: boolean },
): Promise<BackfillSummary> {
  const stuck = await db
    .select({
      participantId: participants.id,
      privyUserId: users.privyUserId,
    })
    .from(users)
    .innerJoin(participants, eq(users.participantId, participants.id))
    .where(and(eq(participants.kind, "human"), isNull(participants.walletAddress)));

  // Only real Privy identities; dev-mode ids (e.g. "player") have no
  // Privy-side user to backfill from.
  const targets = stuck.filter((row) => row.privyUserId.startsWith("did:privy:"));

  const summary: BackfillSummary = {
    scanned: targets.length,
    foundExisting: 0,
    created: 0,
    saved: 0,
    skipped: 0,
    failures: 0,
    confirmed: options.confirm,
  };

  for (const target of targets) {
    let address: string | null;
    let action: BackfillAction;

    try {
      const user = await privy.getUser(target.privyUserId);
      address = embeddedSolanaAddress(user.linkedAccounts);
      if (address) {
        action = "found-existing";
        summary.foundExisting += 1;
      } else if (!options.confirm) {
        action = "would-create";
      } else {
        const updated = await privy.createSolanaWallet(target.privyUserId);
        address = embeddedSolanaAddress(updated.linkedAccounts);
        if (!address) {
          throw new Error(
            "createWallets returned no embedded Solana wallet in linkedAccounts",
          );
        }
        action = "created";
        summary.created += 1;
      }
    } catch (error) {
      summary.failures += 1;
      logLine({
        privyUserId: target.privyUserId,
        action: "skipped-privy-error",
        address: null,
      });
      console.warn(
        `backfill:wallets — Privy call failed for ${target.privyUserId}`,
        error,
      );
      continue;
    }

    if (address && !walletSchema.safeParse({ address }).success) {
      summary.skipped += 1;
      logLine({
        privyUserId: target.privyUserId,
        action: "skipped-invalid-address",
        address,
      });
      continue;
    }

    if (options.confirm && address) {
      action = await saveAddress(db, target.participantId, address, action);
      if (action === "found-existing" || action === "created") {
        summary.saved += 1;
      } else {
        summary.skipped += 1;
      }
    }

    logLine({ privyUserId: target.privyUserId, action, address });
  }

  return summary;
}

// Mirrors POST /wallet (src/api/routes/account.ts): conditional first-write-
// wins update; a filled slot or an address claimed by another participant is a
// warning, not a crash.
async function saveAddress(
  db: Database,
  participantId: string,
  address: string,
  action: BackfillAction,
): Promise<BackfillAction> {
  try {
    const [updated] = await db
      .update(participants)
      .set({ walletAddress: address })
      .where(
        and(
          eq(participants.id, participantId),
          isNull(participants.walletAddress),
        ),
      )
      .returning({ id: participants.id });
    if (updated) return action;
    console.warn(
      `backfill:wallets — participant ${participantId} already has a wallet address; left untouched`,
    );
    return "skipped-already-filled";
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    console.warn(
      `backfill:wallets — address for participant ${participantId} is already claimed by another participant; left untouched`,
    );
    return "skipped-address-taken";
  }
}

function report(summary: BackfillSummary): void {
  console.log(
    `backfill:wallets — scanned ${summary.scanned} stuck users: ` +
      `existing wallets found ${summary.foundExisting}, created ${summary.created}, ` +
      `saved ${summary.saved}, skipped ${summary.skipped}, failures ${summary.failures}` +
      (summary.confirmed
        ? "."
        : ". Dry run — no wallets created, nothing saved; set BACKFILL_CONFIRM=yes to execute."),
  );
  if (summary.failures > 0) process.exitCode = 1;
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  const missing = ["DATABASE_URL", "PRIVY_APP_ID", "PRIVY_APP_SECRET"].filter(
    (name) => !process.env[name],
  );
  if (missing.length > 0) {
    console.error(
      `backfill:wallets cannot run without ${missing.join(", ")}. ` +
        "Set them (all are configured on the Railway app service) and re-run.",
    );
    process.exit(1);
  }

  const client = new PrivyClient(
    process.env.PRIVY_APP_ID as string,
    process.env.PRIVY_APP_SECRET as string,
  );
  const privy: PrivyGateway = {
    getUser: (privyUserId) => client.getUserById(privyUserId),
    createSolanaWallet: (privyUserId) =>
      client.createWallets({ userId: privyUserId, createSolanaWallet: true }),
  };

  const { db, queryClient } = await import("./client");
  const confirm = process.env.BACKFILL_CONFIRM === "yes";
  backfillWallets(db, privy, { confirm })
    .then(report)
    .catch((error: unknown) => {
      console.error("backfill:wallets failed", error);
      process.exitCode = 1;
    })
    .finally(() => {
      void queryClient.end({ timeout: 5 });
    });
}
