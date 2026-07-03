import { eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { participants, users } from "../../db/schema";

export type Participant = typeof participants.$inferSelect;
export type User = typeof users.$inferSelect;

export type AuthedIdentity = {
  participant: Participant;
  user: User;
};

async function findByPrivyUserId(
  db: Database,
  privyUserId: string,
): Promise<AuthedIdentity | null> {
  const [row] = await db
    .select({ participant: participants, user: users })
    .from(users)
    .innerJoin(participants, eq(users.participantId, participants.id))
    .where(eq(users.privyUserId, privyUserId))
    .limit(1);
  return row ?? null;
}

/**
 * Loads the participant/user pair for a verified Privy user id, provisioning
 * both rows in one transaction on the first authenticated request.
 *
 * Idempotent under concurrent first requests: two racing transactions both
 * insert, one hits the users.privy_user_id unique constraint, its whole
 * transaction (including the orphan participant) rolls back, and the loser
 * re-reads the winner's rows.
 */
export async function loadOrProvisionUser(
  db: Database,
  privyUserId: string,
): Promise<AuthedIdentity> {
  const existing = await findByPrivyUserId(db, privyUserId);
  if (existing) return existing;

  try {
    return await db.transaction(async (tx) => {
      const [participant] = await tx
        .insert(participants)
        .values({ kind: "human" })
        .returning();
      if (!participant) throw new Error("participant insert returned no row");

      const [user] = await tx
        .insert(users)
        .values({ participantId: participant.id, privyUserId })
        .returning();
      if (!user) throw new Error("user insert returned no row");

      return { participant, user };
    });
  } catch (error) {
    const winner = await findByPrivyUserId(db, privyUserId);
    if (winner) return winner;
    throw error;
  }
}
