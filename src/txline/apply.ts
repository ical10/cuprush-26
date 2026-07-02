import { eq } from "drizzle-orm";
import type { Database } from "../db/client";
import { fixtures } from "../db/schema";
import type { TxLineEvent } from "./schema";
import type { FixtureUpdate } from "./bus";

export type ApplyOutcome =
  | { applied: true; fixture: typeof fixtures.$inferSelect }
  | { applied: false; reason: "unknown_fixture" }
  | { applied: false; reason: "stale"; fixture: typeof fixtures.$inferSelect };

/**
 * Sequence-guarded apply: compares `event.seq` to `fixtures.last_seq` and
 * applies+advances atomically in one transaction. Duplicate or older events
 * are ignored. See worldcup-hilo-hackathon-research.md, "TxLINE event
 * ordering".
 */
export async function applyTxLineEvent(
  db: Database,
  event: TxLineEvent,
): Promise<ApplyOutcome> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(fixtures)
      .where(eq(fixtures.id, event.fixtureId))
      .for("update");

    if (!current) {
      return { applied: false, reason: "unknown_fixture" } as const;
    }

    if (event.seq <= current.lastSeq) {
      return { applied: false, reason: "stale", fixture: current } as const;
    }

    const [updated] = await tx
      .update(fixtures)
      .set({
        gameState: event.gameState,
        lastSeq: event.seq,
        stats: event.stats,
      })
      .where(eq(fixtures.id, event.fixtureId))
      .returning();

    if (!updated) {
      throw new Error(`failed to advance fixture ${event.fixtureId} to seq ${event.seq}`);
    }

    return { applied: true, fixture: updated } as const;
  });
}

export function toFixtureUpdate(fixture: typeof fixtures.$inferSelect): FixtureUpdate {
  return {
    fixtureId: fixture.id,
    seq: fixture.lastSeq,
    gameState: fixture.gameState,
    stats: fixture.stats,
  };
}
