import { inArray } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import type { Database } from "./client";
import { fixtures } from "./schema";
import {
  isFixtureAllowed,
  parseTeamAllowlist,
  type TeamAllowlist,
} from "../txline/allowlist";

/**
 * One-off cleanup for junk fixtures already ingested from the TxLINE devnet
 * feed before the ingest-side allowlist existed (see src/txline/allowlist.ts).
 *
 * Reads the same TXLINE_TEAM_ALLOWLIST and cancels every fixture that violates
 * it, EXCEPT finished ones (their questions are already settled and points
 * awarded — reversing scores is a product decision, out of scope). Setting a
 * fixture to `cancelled` is all this script does; the question scheduler's
 * fixtureEventTransition then voids that fixture's open questions on its next
 * pass (any pre-live status -> void), and void questions score nobody and push
 * nothing.
 *
 * Dry-run by default (prints what it WOULD cancel). Set CLEANUP_CONFIRM=yes to
 * execute. Idempotent: a fixture already `finished` or `cancelled` is never a
 * cancel target, so re-running after a confirmed pass reports zero to cancel.
 *
 * Refuses to run without an allowlist: cleanup with no allowlist would treat
 * every fixture as junk and cancel the whole board.
 */

type FixtureRow = typeof fixtures.$inferSelect;

export type CleanupSummary = {
  scanned: number;
  violating: number;
  toCancel: FixtureRow[];
  finishedJunk: number;
  alreadyCancelled: number;
  cancelled: number;
  confirmed: boolean;
};

export type CleanupOptions = {
  allowlist: TeamAllowlist;
  confirm: boolean;
};

export async function cleanupFixtures(
  db: Database,
  options: CleanupOptions,
): Promise<CleanupSummary> {
  if (options.allowlist === null) {
    throw new Error(
      "cleanup:fixtures refuses to run without TXLINE_TEAM_ALLOWLIST — an empty " +
        "allowlist would mark every fixture as junk and cancel the whole board. " +
        "Set TXLINE_TEAM_ALLOWLIST to the real team list and re-run.",
    );
  }

  const all = await db.select().from(fixtures);
  const violating = all.filter(
    (fixture) => !isFixtureAllowed(options.allowlist, fixture.homeTeam, fixture.awayTeam),
  );

  const toCancel = violating.filter(
    (fixture) => fixture.gameState !== "finished" && fixture.gameState !== "cancelled",
  );
  const finishedJunk = violating.filter((fixture) => fixture.gameState === "finished");
  const alreadyCancelled = violating.filter((fixture) => fixture.gameState === "cancelled");

  let cancelled = 0;
  if (options.confirm && toCancel.length > 0) {
    const updated = await db
      .update(fixtures)
      .set({ gameState: "cancelled" })
      .where(
        inArray(
          fixtures.id,
          toCancel.map((fixture) => fixture.id),
        ),
      )
      .returning({ id: fixtures.id });
    cancelled = updated.length;
  }

  return {
    scanned: all.length,
    violating: violating.length,
    toCancel,
    finishedJunk: finishedJunk.length,
    alreadyCancelled: alreadyCancelled.length,
    cancelled,
    confirmed: options.confirm,
  };
}

function report(summary: CleanupSummary): void {
  const verb = summary.confirmed ? "cancelled" : "would cancel";
  for (const fixture of summary.toCancel) {
    console.log(
      `cleanup:fixtures — ${verb} ${fixture.id} (${fixture.homeTeam} vs ${fixture.awayTeam}, was ${fixture.gameState})`,
    );
  }
  console.log(
    `cleanup:fixtures — scanned ${summary.scanned}, violating ${summary.violating}: ` +
      `${verb} ${summary.toCancel.length}, finished junk left intact ${summary.finishedJunk}, ` +
      `already cancelled ${summary.alreadyCancelled}` +
      (summary.confirmed
        ? `. Cancelled ${summary.cancelled}; the scheduler will void their open questions on its next pass.`
        : ". Dry run — set CLEANUP_CONFIRM=yes to execute."),
  );
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  const { db, queryClient } = await import("./client");
  const allowlist = parseTeamAllowlist(process.env.TXLINE_TEAM_ALLOWLIST);
  const confirm = process.env.CLEANUP_CONFIRM === "yes";
  cleanupFixtures(db, { allowlist, confirm })
    .then(report)
    .catch((error: unknown) => {
      console.error("cleanup:fixtures failed", error);
      process.exitCode = 1;
    })
    .finally(() => {
      void queryClient.end({ timeout: 5 });
    });
}
