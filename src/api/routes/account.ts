import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { participants, users } from "../../db/schema";
import type { AuthAdapter } from "../auth/adapter";
import {
  createAuthMiddleware,
  type AuthEnvBindings,
  type DbProvider,
} from "../auth/middleware";
import type { Participant } from "../auth/provision";

// PATCH /api/me may change displayName and nothing else.
export const patchMeSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(32),
});

// Solana addresses are base58-encoded 32-byte keys: 32-44 chars, no 0/O/I/l.
export const walletSchema = z.strictObject({
  address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
});

// Postgres unique_violation, possibly wrapped in a DrizzleQueryError whose
// `cause` carries the original postgres-js error.
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

function mePayload(participant: Participant) {
  return {
    displayName: participant.displayName,
    points: participant.points,
    currentStreak: participant.currentStreak,
    bestStreak: participant.bestStreak,
    walletAddress: participant.walletAddress,
  };
}

/**
 * Authenticated account routes. The participant is always taken from the
 * verified token (auth middleware context vars), never from the request body.
 */
export function createAccountRoutes(getDb: DbProvider, auth: AuthAdapter) {
  const app = new Hono<AuthEnvBindings>();
  const requireAuth = createAuthMiddleware(auth, getDb);

  app.get("/me", requireAuth, (c) => {
    return c.json(mePayload(c.get("participant")));
  });

  app.patch("/me", requireAuth, async (c) => {
    const body = patchMeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: "displayName must be 1-32 characters" }, 400);
    }

    const db = await getDb();
    const [updated] = await db
      .update(participants)
      .set({ displayName: body.data.displayName })
      .where(eq(participants.id, c.get("participant").id))
      .returning();
    if (!updated) return c.json({ error: "not found" }, 404);

    return c.json(mePayload(updated));
  });

  // Anonymizes the off-chain profile: clears the display name, deletes the
  // users row (the Privy identity mapping), marks delegation revoked, and
  // releases the unique wallet address — Privy hands the same embedded wallet
  // back on re-signup, so keeping the address here would make POST /wallet
  // 409 forever for the new account. The participant row survives so retained
  // predictions stay attributable to an (anonymous) participant, and on-chain
  // data can never be erased — the client must disclose that before
  // confirming.
  app.delete("/me", requireAuth, async (c) => {
    const db = await getDb();
    const participantId = c.get("participant").id;
    await db.transaction(async (tx) => {
      await tx.delete(users).where(eq(users.participantId, participantId));
      await tx
        .update(participants)
        .set({
          displayName: null,
          walletAddress: null,
          // Keep the first revocation timestamp if delegation was already
          // revoked before deletion.
          delegationRevokedAt: sql`coalesce(${participants.delegationRevokedAt}, now())`,
        })
        .where(eq(participants.id, participantId));
    });
    return c.body(null, 204);
  });

  // The backend is stateless (the Privy access token is the only session
  // state, verified per request, never stored). Logout is therefore a
  // client-side action — clear the Privy session in the browser. This
  // endpoint exists so the client has one uniform account API.
  app.post("/logout", (c) => c.body(null, 204));

  // Records the embedded wallet address on the participant. Immutable once
  // set: a different address for a participant that already has one is a 409,
  // as is an address already claimed by another participant.
  app.post("/wallet", requireAuth, async (c) => {
    const body = walletSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      return c.json({ error: "address must be base58, 32-44 characters" }, 400);
    }
    const { address } = body.data;
    const participant = c.get("participant");

    if (participant.walletAddress) {
      if (participant.walletAddress === address) {
        return c.json({ walletAddress: address });
      }
      return c.json({ error: "wallet address is immutable once set" }, 409);
    }

    const db = await getDb();
    try {
      // Conditional update: only claims the slot while it is still empty, so
      // two racing first writes can never overwrite each other.
      const [updated] = await db
        .update(participants)
        .set({ walletAddress: address })
        .where(
          and(
            eq(participants.id, participant.id),
            isNull(participants.walletAddress),
          ),
        )
        .returning();
      if (updated) return c.json({ walletAddress: address });
    } catch (error) {
      // participants.wallet_address unique violation: claimed by another
      // participant. Fall through to the conflict re-read below.
      if (!isUniqueViolation(error)) throw error;
    }

    const [current] = await db
      .select({ walletAddress: participants.walletAddress })
      .from(participants)
      .where(eq(participants.id, participant.id));
    if (current?.walletAddress === address) {
      return c.json({ walletAddress: address });
    }
    return c.json({ error: "wallet address is immutable once set" }, 409);
  });

  // Records the revocation of server signing authority. The actual
  // Privy-side delegation revocation is HITL until Privy credentials land
  // (see PRD "Delivery constraints"); this timestamp is the durable record
  // of the request, and the backend must not submit transactions for a
  // participant whose delegation_revoked_at is set.
  app.post("/wallet/delegation/revoke", requireAuth, async (c) => {
    const db = await getDb();
    const participantId = c.get("participant").id;
    // Idempotent: keeps the first revocation timestamp.
    await db
      .update(participants)
      .set({ delegationRevokedAt: new Date() })
      .where(
        and(
          eq(participants.id, participantId),
          isNull(participants.delegationRevokedAt),
        ),
      );
    const [row] = await db
      .select({ delegationRevokedAt: participants.delegationRevokedAt })
      .from(participants)
      .where(eq(participants.id, participantId));
    return c.json({
      delegationRevokedAt: row?.delegationRevokedAt?.toISOString() ?? null,
    });
  });

  return app;
}
