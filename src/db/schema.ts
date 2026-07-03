import { sql } from "drizzle-orm";
import {
  check,
  integer,
  jsonb,
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
    kind: participantKind("kind").notNull(),
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
    predictionPda: varchar("prediction_pda", { length: 44 }).unique(),
    chainStatus: predictionChainStatus("chain_status")
      .notNull()
      .default("pending"),
    signature: varchar("signature", { length: 88 }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    scoredAt: timestamp("scored_at", { withTimezone: true }),
    // Chain-submit retry bookkeeping: capped exponential backoff while the
    // row is pending, until the question locks (then failed). See
    // src/predictions/reconciler.ts.
    attemptCount: integer("attempt_count").notNull().default(0),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    lastError: text("last_error"),
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
    check(
      "predictions_attempt_count_nonnegative",
      sql`${prediction.attemptCount} >= 0`,
    ),
  ],
);
