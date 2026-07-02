import { z } from "zod";
import type {
  FixtureGameState,
  FixturePeriodKey,
  FixtureStats,
  FixtureTeamStats,
} from "../db/schema";

/**
 * TxLINE payload shapes.
 *
 * No real TxLINE credentials or captured payload exist yet (see
 * worldcup-hilo-hackathon-research.md, "TxLINE event ordering"). This module
 * is the single place to adjust field names and shapes once a real payload
 * is captured — every other module only ever sees the normalized
 * (camelCase) output types below, never the raw wire shape.
 *
 * Assumed wire format: snake_case fields, per-team stat totals keyed by
 * period. Adjust the raw z.object() shapes below to match reality; keep the
 * `.transform()` output shape stable so downstream code doesn't change.
 */

const FIXTURE_GAME_STATES = [
  "scheduled",
  "live",
  "finished",
  "postponed",
  "cancelled",
  "abandoned",
] as const satisfies readonly FixtureGameState[];

export const txLineGameStateSchema = z.enum(FIXTURE_GAME_STATES);

const PERIOD_KEYS = [
  "full_time",
  "first_half",
  "second_half",
] as const satisfies readonly FixturePeriodKey[];

export const txLinePeriodKeySchema = z.enum(PERIOD_KEYS);

const txLineTeamStatsSchema = z
  .object({
    goals: z.number().int().nonnegative(),
    yellow_cards: z.number().int().nonnegative(),
    red_cards: z.number().int().nonnegative(),
    corners: z.number().int().nonnegative(),
  })
  .transform(
    (raw): FixtureTeamStats => ({
      goals: raw.goals,
      yellowCards: raw.yellow_cards,
      redCards: raw.red_cards,
      corners: raw.corners,
    }),
  );

const txLinePeriodStatsSchema = z.object({
  home: txLineTeamStatsSchema,
  away: txLineTeamStatsSchema,
});

// `full_time` totals are always required; half-specific breakdowns are only
// sent once TxLINE has them, so they're optional.
export const txLineStatsSchema = z
  .object({
    full_time: txLinePeriodStatsSchema,
    first_half: txLinePeriodStatsSchema.optional(),
    second_half: txLinePeriodStatsSchema.optional(),
  })
  .transform((raw): FixtureStats => {
    const stats: FixtureStats = { full_time: raw.full_time };
    if (raw.first_half) stats.first_half = raw.first_half;
    if (raw.second_half) stats.second_half = raw.second_half;
    return stats;
  });

const EVENT_TYPES = [
  "goal",
  "yellow_card",
  "red_card",
  "corner",
  "state_change",
] as const;

export const txLineEventTypeSchema = z.enum(EVENT_TYPES);
export type TxLineEventType = z.infer<typeof txLineEventTypeSchema>;

// One applied TxLINE event: the event `type` says what just changed (for UI
// animation), `stats` is the fixture's full current cumulative totals (not
// a delta), so applying an event is always "replace with newer state".
export const txLineEventSchema = z
  .object({
    fixture_id: z.string().min(1),
    seq: z.number().int().nonnegative(),
    type: txLineEventTypeSchema,
    game_state: txLineGameStateSchema,
    occurred_at: z.iso.datetime(),
    stats: txLineStatsSchema,
  })
  .transform((raw) => ({
    fixtureId: raw.fixture_id,
    seq: raw.seq,
    type: raw.type,
    gameState: raw.game_state,
    occurredAt: raw.occurred_at,
    stats: raw.stats,
  }));

export type TxLineEvent = z.infer<typeof txLineEventSchema>;

// The TxLINE snapshot endpoint's per-fixture shape, fetched on (re)connect
// before resuming the stream.
export const txLineFixtureSnapshotSchema = z
  .object({
    fixture_id: z.string().min(1),
    home_team: z.string().min(1),
    away_team: z.string().min(1),
    starts_at: z.iso.datetime(),
    game_state: txLineGameStateSchema,
    seq: z.number().int().nonnegative(),
    stats: txLineStatsSchema,
  })
  .transform((raw) => ({
    fixtureId: raw.fixture_id,
    homeTeam: raw.home_team,
    awayTeam: raw.away_team,
    startsAt: raw.starts_at,
    gameState: raw.game_state,
    seq: raw.seq,
    stats: raw.stats,
  }));

export type TxLineFixtureSnapshot = z.infer<typeof txLineFixtureSnapshotSchema>;

export const txLineFixtureListSchema = z.array(txLineFixtureSnapshotSchema);

// One captured replay file: a fixture's starting snapshot plus its ordered
// event stream. Used by the replay client and its sample fixtures/ files.
export const txLineReplayFileSchema = z
  .object({
    snapshot: txLineFixtureSnapshotSchema,
    events: z.array(txLineEventSchema).min(1),
  })
  .refine(
    (file) => file.events.every((event) => event.fixtureId === file.snapshot.fixtureId),
    { message: "every event must reference the snapshot's fixture_id" },
  )
  .refine(
    (file) =>
      file.events.every((event, index, all) => {
        if (index === 0) return true;
        const previous = all[index - 1];
        return previous !== undefined && event.seq > previous.seq;
      }),
    { message: "events must be strictly increasing by seq" },
  );

export type TxLineReplayFile = z.infer<typeof txLineReplayFileSchema>;
