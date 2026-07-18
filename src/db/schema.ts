import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// --- participants & users -------------------------------------------------

export const participantKind = pgEnum("participant_kind", ["human", "agent"]);

export const participants = pgTable(
  "participants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: participantKind("kind").notNull().default("human"),
    walletAddress: varchar("wallet_address", { length: 44 }).unique(),
    displayName: varchar("display_name", { length: 32 }),
    points: integer("points").notNull().default(0),
    currentStreak: integer("current_streak").notNull().default(0),
    bestStreak: integer("best_streak").notNull().default(0),
    // Records the user's request to revoke server signing authority over
    // their embedded wallet. The Privy-side delegation revocation itself is
    // HITL (no Privy credentials yet) — this timestamp is the durable,
    // auditable record of the request.
    delegationRevokedAt: timestamp("delegation_revoked_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (participant) => [
    check("participants_points_nonnegative", sql`${participant.points} >= 0`),
    check(
      "participants_current_streak_nonnegative",
      sql`${participant.currentStreak} >= 0`,
    ),
    check(
      "participants_best_streak_nonnegative",
      sql`${participant.bestStreak} >= 0`,
    ),
  ],
);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  participantId: uuid("participant_id")
    .notNull()
    .unique()
    .references(() => participants.id),
  privyUserId: text("privy_user_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- fixtures ---------------------------------------------------------------

export const fixtureGameState = pgEnum("fixture_game_state", [
  "scheduled",
  "live",
  "finished",
  "postponed",
  "cancelled",
  "abandoned",
]);

export type FixtureGameState = (typeof fixtureGameState.enumValues)[number];

// Tournament stage drives the per-fixture question budget (see
// src/questions/stage-budget.ts). Defaults to "group" for fixtures ingested
// without an explicit stage (TxLINE's feed doesn't carry tournament round).
export const fixtureStage = pgEnum("fixture_stage", [
  "group",
  "early_knockout",
  "semi_final",
  "final",
]);

export type FixtureStage = (typeof fixtureStage.enumValues)[number];

// Per-team totals for one TxLINE-supported stat category.
export type FixtureTeamStats = {
  goals: number;
  yellowCards: number;
  redCards: number;
  corners: number;
};

// Only the period keys TxLINE's feed and the question templates need.
export type FixturePeriodKey = "full_time" | "first_half" | "second_half";

// Current per-fixture stat totals applied from TxLINE events, keyed by
// period. `full_time` is always present once any event has been applied;
// half-specific totals are filled in as they become available.
export type FixtureStats = Partial<
  Record<FixturePeriodKey, { home: FixtureTeamStats; away: FixtureTeamStats }>
>;

export const fixtures = pgTable(
  "fixtures",
  {
    // TxLINE fixture ID is the durable primary key.
    id: text("id").primaryKey(),
    homeTeam: text("home_team").notNull(),
    awayTeam: text("away_team").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    gameState: fixtureGameState("game_state").notNull().default("scheduled"),
    stage: fixtureStage("stage").notNull().default("group"),
    // Durable TxLINE cursor: accept an event only if its sequence is newer.
    lastSeq: integer("last_seq").notNull().default(0),
    // Current per-team stat totals from TxLINE, advanced atomically with
    // last_seq. See src/txline/apply.ts.
    stats: jsonb("stats").$type<FixtureStats>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (fixture) => [
    check("fixtures_last_seq_nonnegative", sql`${fixture.lastSeq} >= 0`),
  ],
);

// --- questions ---------------------------------------------------------------

export const questionOperator = pgEnum("question_operator", [
  "add",
  "subtract",
]);

export const questionComparison = pgEnum("question_comparison", [
  "equal",
  "greater_than",
  "less_than",
]);

export const questionStatus = pgEnum("question_status", [
  "scheduled",
  "open",
  "locked",
  "live",
  "settling",
  "settled",
  "void",
]);

export type QuestionStatus = (typeof questionStatus.enumValues)[number];

export const questionResult = pgEnum("question_result", [
  "yes",
  "no",
  "higher",
  "lower",
  "push",
]);

export const questions = pgTable(
  "questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fixtureId: text("fixture_id")
      .notNull()
      .references(() => fixtures.id),
    // Set only for inter-fixture benchmark questions.
    benchmarkFixtureId: text("benchmark_fixture_id").references(
      () => fixtures.id,
    ),
    template: text("template").notNull(),
    statKey1: text("stat_key_1").notNull(),
    statKey2: text("stat_key_2").notNull(),
    period: text("period"),
    operator: questionOperator("operator").notNull(),
    comparison: questionComparison("comparison").notNull(),
    threshold: integer("threshold"),
    // Proven anchor value for inter-fixture benchmark questions.
    benchmarkValue: integer("benchmark_value"),
    status: questionStatus("status").notNull().default("scheduled"),
    result: questionResult("result"),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
    locksAt: timestamp("locks_at", { withTimezone: true }).notNull(),
    // Set when live->settling happens (fixture bus terminal event), so the
    // scheduler can detect a settlement stuck past the 30-minute deadline.
    // Settlement itself is issue 9's concern — this column only supports
    // the overdue *scan*.
    settlingAt: timestamp("settling_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    lastError: text("last_error"),
    questionPda: varchar("question_pda", { length: 44 }).unique(),
    settlementSignature: varchar("settlement_signature", { length: 88 }),
    // Canonical hash of the immutable on-chain rule; guards against
    // regenerating a duplicate question for the same fixture/rule.
    ruleHash: text("rule_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (question) => [
    check(
      "questions_attempt_count_nonnegative",
      sql`${question.attemptCount} >= 0`,
    ),
  ],
);

// --- predictions ---------------------------------------------------------------

export const predictionOutcome = pgEnum("prediction_outcome", [
  "yes",
  "no",
  "higher",
  "lower",
]);

export const predictionChainStatus = pgEnum("prediction_chain_status", [
  "pending",
  "confirmed",
  "failed",
]);

/**
 * One batch per participant per fixture holds the on-chain commitment for
 * that fixture's predictions (research doc "Prediction submission", batched
 * variant). The chain fields that used to live per-prediction row moved here:
 * a single batch hash is submitted on chain instead of one PDA per answer.
 * A participant answering across two fixtures gets two batches, each
 * committing independently.
 */
export const predictionBatches = pgTable(
  "prediction_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // The batch's participant. Uniqueness is now the (participant, fixture)
    // pair below — one batch per fixture, not one batch ever.
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    // The fixture this batch commits predictions for. Mirrors
    // questions.fixture_id → fixtures.id (ON DELETE no action): fixtures are
    // durable TxLINE rows, never deleted out from under a live batch.
    fixtureId: text("fixture_id")
      .notNull()
      .references(() => fixtures.id),
    // sha256 hex of the canonical sorted questionId:outcome pairs — see
    // src/predictions/hash.ts. Recomputed server-side, never client-supplied.
    batchHash: text("batch_hash").notNull(),
    batchPda: varchar("batch_pda", { length: 44 }).unique(),
    chainStatus: predictionChainStatus("chain_status")
      .notNull()
      .default("pending"),
    signature: varchar("signature", { length: 88 }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    // Chain-submit retry bookkeeping: capped exponential backoff while the
    // row is pending. See src/predictions/reconciler.ts.
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (batch) => [
    // One batch per participant per fixture.
    unique("prediction_batches_participant_fixture_unique").on(
      batch.participantId,
      batch.fixtureId,
    ),
    check(
      "prediction_batches_attempt_count_nonnegative",
      sql`${batch.attemptCount} >= 0`,
    ),
  ],
);

export const predictions = pgTable(
  "predictions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Account deletion anonymizes the participant but never deletes it, so
    // this stays RESTRICT: a participant with predictions can't be removed.
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id),
    outcome: predictionOutcome("outcome").notNull(),
    // The batch carrying this prediction's on-chain commitment.
    batchId: uuid("batch_id")
      .notNull()
      .references(() => predictionBatches.id, { onDelete: "restrict" }),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (prediction) => [
    // One immutable prediction per participant per question.
    unique("predictions_participant_question_unique").on(
      prediction.participantId,
      prediction.questionId,
    ),
  ],
);

// --- agent cohort -----------------------------------------------------------

export const agentCohortStatus = pgEnum("agent_cohort_status", [
  "active",
  "paused",
  "revoked",
]);

export type AgentCohortStatus = (typeof agentCohortStatus.enumValues)[number];

// A Hermes relay's credential scope: one row per cohort of AI players. The
// bearer token is stored only as a hash; the plaintext is printed once during
// provisioning. `token_hash` stays null between seed and provisioning.
export const agentCohorts = pgTable("agent_cohorts", {
  id: uuid("id").defaultRandom().primaryKey(),
  // The human operator who owns this cohort. Owners are never hard-deleted, so
  // this stays RESTRICT: a user with a cohort can't be removed out from under
  // it.
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  name: varchar("name", { length: 64 }).notNull(),
  // sha256 of the cohort bearer token, filled at provisioning time.
  tokenHash: text("token_hash").unique(),
  status: agentCohortStatus("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Set when the token is rotated, invalidating the previous hash.
  rotatedAt: timestamp("rotated_at", { withTimezone: true }),
});

// --- agents -----------------------------------------------------------------

export const agentStatus = pgEnum("agent_status", [
  "seeded",
  "active",
  "paused",
  "revoked",
]);

export type AgentStatus = (typeof agentStatus.enumValues)[number];

// The agent-specific extension of a participant (1:1). The participant carries
// shared identity, scoring, and wallet; this row carries persona/strategy and
// the cohort binding. `privy_wallet_id` stays null until provisioning maps a
// Privy server wallet.
export const agents = pgTable("agents", {
  // Shared identity row. Participants are anonymized, never hard-deleted, so
  // this stays RESTRICT — mirrors predictions/prediction_batches.
  participantId: uuid("participant_id")
    .primaryKey()
    .references(() => participants.id, { onDelete: "restrict" }),
  // Cohorts are revoked via status, never hard-deleted, so RESTRICT: a cohort
  // with agents can't be removed.
  cohortId: uuid("cohort_id")
    .notNull()
    .references(() => agentCohorts.id, { onDelete: "restrict" }),
  agentKey: varchar("agent_key", { length: 32 }).notNull().unique(),
  persona: text("persona").notNull(),
  strategy: text("strategy").notNull(),
  model: varchar("model", { length: 64 }).notNull(),
  privyWalletId: varchar("privy_wallet_id", { length: 64 }).unique(),
  status: agentStatus("status").notNull().default("seeded"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- agent decisions --------------------------------------------------------

// One validated decision per agent participant per question. Raw model output
// is never stored — only schema-validated fields land here. The composite
// unique is the natural key (no surrogate id, per the design data model).
export const agentDecisions = pgTable(
  "agent_decisions",
  {
    // Account deletion anonymizes the participant but never deletes it, so
    // this stays RESTRICT — mirrors predictions.participant_id.
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "restrict" }),
    // Mirrors predictions.question_id: default (no action) on delete.
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id),
    outcome: varchar("outcome", { length: 16 }).notNull(),
    confidence: numeric("confidence").notNull(),
    rationale: varchar("rationale", { length: 280 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (decision) => [
    // One decision per participant per question.
    unique("agent_decisions_participant_question_unique").on(
      decision.participantId,
      decision.questionId,
    ),
    check(
      "agent_decisions_confidence_range",
      sql`${decision.confidence} >= 0 AND ${decision.confidence} <= 1`,
    ),
  ],
);
