import { asc, eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import type { Database } from "./client";
import { agentCohorts, agents, participants, users } from "./schema";

/**
 * Non-secret seed of the season-1 AI cohort. Commits ten distinct, durable
 * agent identities (persona + strategy) plus their cohort and participant
 * rows. It never touches tokens, wallets, or any secret material — those are
 * provisioned separately by `pnpm provision:agents`.
 *
 * This seed is production-legitimate: the cohort and its ten agents are real
 * identities, not throwaway demo data, so unlike seed:demo it does not refuse
 * to run under NODE_ENV=production. It is strictly idempotent: every write is
 * an insert guarded by a natural key, and re-running only skips rows that
 * already exist — it never updates a provisioned agent back to a seeded state.
 */

export const COHORT_NAME = "cuprush-ai-s1";

// Placeholder model tag. Provisioning and the Hermes relay own the real model
// binding; the seed only records the pinned-model intent.
export const SEED_MODEL = "hermes-pinned";

export type AgentSeed = {
  agentKey: string;
  displayName: string;
  persona: string;
  strategy: string;
};

// Ten distinct, product-quality personas. display_name <= 32 chars,
// agent_key <= 32 chars, persona/strategy one sentence each.
export const AGENT_SEEDS: readonly AgentSeed[] = [
  {
    agentKey: "form-hawk",
    displayName: "Form Hawk",
    persona:
      "Obsessive tracker of the last five matches who trusts momentum over reputation.",
    strategy: "Weights recent form heavily and fades teams on cold streaks.",
  },
  {
    agentKey: "contrarian",
    displayName: "The Contrarian",
    persona: "Perpetual sceptic who assumes the crowd is usually wrong.",
    strategy:
      "Bets against the consensus favourite whenever public sentiment looks lopsided.",
  },
  {
    agentKey: "home-bias",
    displayName: "Fortress Keeper",
    persona: "Believes home advantage still quietly decides the tight matches.",
    strategy: "Leans toward the home side on goals, corners, and cards.",
  },
  {
    agentKey: "cards-pessimist",
    displayName: "Card Sharp",
    persona: "Expects every match to boil over into a referee's nightmare.",
    strategy: "Skews toward the over on yellow and red card totals.",
  },
  {
    agentKey: "corners-maximalist",
    displayName: "Corner Merchant",
    persona: "Sees attacking width and set-piece chaos everywhere on the pitch.",
    strategy: "Favours the over on corner counts in open, attacking fixtures.",
  },
  {
    agentKey: "coin-flip",
    displayName: "Even Steven",
    persona: "The unbothered baseline who treats every question as a fair coin.",
    strategy: "Picks each outcome at roughly even odds as a control benchmark.",
  },
  {
    agentKey: "streak-rider",
    displayName: "Streak Rider",
    persona: "Rides whatever is hot until it visibly cools.",
    strategy: "Backs teams and trends that are currently winning or trending up.",
  },
  {
    agentKey: "underdog-lover",
    displayName: "Giant Slayer",
    persona: "Romantic who lives for the upset and the unlikely comeback.",
    strategy: "Tilts toward underdogs and long-shot outcomes for the upside.",
  },
  {
    agentKey: "stats-purist",
    displayName: "The Quant",
    persona: "Cold-blooded numbers analyst who ignores narrative entirely.",
    strategy:
      "Chooses the outcome closest to the historical statistical baseline.",
  },
  {
    agentKey: "chaos-goblin",
    displayName: "Chaos Goblin",
    persona: "Agent of mayhem who assumes football is fundamentally absurd.",
    strategy:
      "Leans toward high-variance, surprising outcomes just to shake the table.",
  },
];

export type SeedAgentsSummary = {
  cohortId: string;
  cohortCreated: boolean;
  agentsCreated: number;
  agentsSkipped: number;
};

/**
 * Idempotently seeds the cohort, its ten participant rows, and their agent
 * rows. The cohort owner is the earliest-created user in the database; if the
 * users table is empty the seed refuses to run rather than fabricate an
 * identity (a cohort owner is a real, auth-bearing user).
 */
export async function seedAgents(database: Database): Promise<SeedAgentsSummary> {
  const [owner] = await database
    .select({ id: users.id })
    .from(users)
    .orderBy(asc(users.createdAt))
    .limit(1);

  if (!owner) {
    throw new Error(
      "seed:agents needs a cohort owner but the users table is empty. Sign " +
        "in once (which provisions the first user) and re-run, so the cohort " +
        "is owned by a real user rather than a fabricated identity.",
    );
  }

  // Get-or-create the cohort by name. agent_cohorts.name has no unique
  // constraint, so we guard with a select rather than onConflictDoNothing.
  const [existingCohort] = await database
    .select({ id: agentCohorts.id })
    .from(agentCohorts)
    .where(eq(agentCohorts.name, COHORT_NAME))
    .limit(1);

  let cohortId: string;
  let cohortCreated = false;
  if (existingCohort) {
    cohortId = existingCohort.id;
  } else {
    const [created] = await database
      .insert(agentCohorts)
      .values({ ownerUserId: owner.id, name: COHORT_NAME })
      .returning({ id: agentCohorts.id });
    if (!created) throw new Error("cohort insert returned no row");
    cohortId = created.id;
    cohortCreated = true;
  }

  let agentsCreated = 0;
  let agentsSkipped = 0;

  for (const seed of AGENT_SEEDS) {
    // agents.agent_key is unique and is the idempotency anchor: if it exists,
    // the participant + agent pair is already seeded and is never mutated.
    const [existingAgent] = await database
      .select({ participantId: agents.participantId })
      .from(agents)
      .where(eq(agents.agentKey, seed.agentKey))
      .limit(1);

    if (existingAgent) {
      agentsSkipped += 1;
      continue;
    }

    // One transaction per agent so a participant is never created without its
    // agent row (no orphan participants on partial failure).
    await database.transaction(async (tx) => {
      const [participant] = await tx
        .insert(participants)
        .values({ kind: "agent", displayName: seed.displayName })
        .returning({ id: participants.id });
      if (!participant) throw new Error("participant insert returned no row");

      await tx.insert(agents).values({
        participantId: participant.id,
        cohortId,
        agentKey: seed.agentKey,
        persona: seed.persona,
        strategy: seed.strategy,
        model: SEED_MODEL,
      });
    });

    agentsCreated += 1;
  }

  return { cohortId, cohortCreated, agentsCreated, agentsSkipped };
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  // Import the DB client lazily so importing this module for its seed data
  // (e.g. from unit tests) never requires DATABASE_URL.
  const { db, queryClient } = await import("./client");
  seedAgents(db)
    .then((summary) => {
      console.log(
        `seed:agents — cohort ${COHORT_NAME} ${
          summary.cohortCreated ? "created" : "reused"
        } (${summary.cohortId}); agents created ${summary.agentsCreated}, ` +
          `skipped ${summary.agentsSkipped}`,
      );
    })
    .catch((error: unknown) => {
      console.error("seed:agents failed", error);
      process.exitCode = 1;
    })
    .finally(() => {
      void queryClient.end({ timeout: 5 });
    });
}
