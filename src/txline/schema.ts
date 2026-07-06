import { z } from "zod";
import type {
  FixtureGameState,
  FixtureStats,
  FixtureTeamStats,
} from "../db/schema";

/**
 * TxLINE payload shapes, matching the real wire contract captured from the
 * devnet API (see src/txline/fixtures/captured/). This module is the single
 * adjust-point for wire field names — every other module only ever sees the
 * normalized (camelCase) output types below, never the raw PascalCase shape.
 *
 * Wire facts the mapping relies on:
 * - Score events arrive UNORDERED; `Seq` (per-fixture, strictly increasing
 *   with gaps) is the only ordering key. `Id` is not unique — never use it.
 * - The event-level `GameState` string is stale ("scheduled" even after
 *   game_finalised) and the fixture-snapshot `GameState` number is
 *   undocumented — both are ignored. State derives from `Action`:
 *   game_finalised → finished, any other Score-bearing action → live.
 * - `Score` is cumulative and sparse: missing period/stat keys mean 0.
 *   Events without a `Score` object are informational and never applied.
 * - `Participant1IsHome` decides home/away for names and score mapping.
 */

// One applied TxLINE event: `type` says what just changed (for UI
// animation), `stats` is the fixture's full current cumulative totals (not
// a delta), so applying an event is always "replace with newer state".
export type TxLineEventType =
  | "goal"
  | "yellow_card"
  | "red_card"
  | "corner"
  | "state_change";

export type TxLineEvent = {
  fixtureId: string;
  seq: number;
  type: TxLineEventType;
  gameState: FixtureGameState;
  occurredAt: string;
  stats: FixtureStats;
};

const STAT_ACTIONS = new Set<string>(["goal", "yellow_card", "red_card", "corner"]);

function toEventType(action: string): TxLineEventType {
  return STAT_ACTIONS.has(action) ? (action as TxLineEventType) : "state_change";
}

// Sparse per-period totals: a missing key means 0.
const wirePeriodSchema = z.object({
  Goals: z.number().int().nonnegative().optional(),
  YellowCards: z.number().int().nonnegative().optional(),
  RedCards: z.number().int().nonnegative().optional(),
  Corners: z.number().int().nonnegative().optional(),
});

type WirePeriod = z.infer<typeof wirePeriodSchema>;

// HT (score at the half-time whistle) is intentionally not modeled — only
// H1/H2/Total map to the FixtureStats periods the question templates use.
const wireParticipantScoreSchema = z.object({
  H1: wirePeriodSchema.optional(),
  H2: wirePeriodSchema.optional(),
  Total: wirePeriodSchema.optional(),
});

type WireParticipantScore = z.infer<typeof wireParticipantScoreSchema>;

const wireScoreSchema = z.object({
  Participant1: wireParticipantScoreSchema.optional(),
  Participant2: wireParticipantScoreSchema.optional(),
});

type WireScore = z.infer<typeof wireScoreSchema>;

function toTeamStats(period: WirePeriod | undefined): FixtureTeamStats {
  return {
    goals: period?.Goals ?? 0,
    yellowCards: period?.YellowCards ?? 0,
    redCards: period?.RedCards ?? 0,
    corners: period?.Corners ?? 0,
  };
}

function toFixtureStats(score: WireScore, participant1IsHome: boolean): FixtureStats {
  const home = participant1IsHome ? score.Participant1 : score.Participant2;
  const away = participant1IsHome ? score.Participant2 : score.Participant1;

  const period = (key: keyof WireParticipantScore) => ({
    home: toTeamStats(home?.[key]),
    away: toTeamStats(away?.[key]),
  });

  const stats: FixtureStats = { full_time: period("Total") };
  if (home?.H1 || away?.H1) stats.first_half = period("H1");
  if (home?.H2 || away?.H2) stats.second_half = period("H2");
  return stats;
}

const wireEventShape = {
  FixtureId: z.number().int(),
  Seq: z.number().int().nonnegative(),
  Ts: z.number().int().nonnegative(),
  Action: z.string().min(1),
  Participant1IsHome: z.boolean(),
  Score: wireScoreSchema.optional(),
};

/**
 * Any event from the scores snapshot or SSE stream. `Score` is present only
 * on score-bearing actions; the 40+ informational actions (comment, shot,
 * possession, …) parse here too and are skipped by wireEventToTxLineEvent.
 */
export const txLineWireEventSchema = z.object(wireEventShape);

export type TxLineWireEvent = z.infer<typeof txLineWireEventSchema>;

function buildTxLineEvent(raw: TxLineWireEvent & { Score: WireScore }): TxLineEvent {
  return {
    fixtureId: String(raw.FixtureId),
    seq: raw.Seq,
    type: toEventType(raw.Action),
    gameState: raw.Action === "game_finalised" ? "finished" : "live",
    occurredAt: new Date(raw.Ts).toISOString(),
    stats: toFixtureStats(raw.Score, raw.Participant1IsHome),
  };
}

/** A Score-bearing wire event, normalized to the stable TxLineEvent shape. */
export const txLineEventSchema = z
  .object({ ...wireEventShape, Score: wireScoreSchema })
  .transform(buildTxLineEvent);

/**
 * Normalizes an already-parsed wire event, or returns null for events
 * without a `Score` (informational actions never advance a fixture).
 */
export function wireEventToTxLineEvent(wire: TxLineWireEvent): TxLineEvent | null {
  if (!wire.Score) return null;
  return buildTxLineEvent({ ...wire, Score: wire.Score });
}

/**
 * Parses a raw `GET /api/scores/snapshot/{fixtureId}` body: sorts the
 * unordered events by Seq ascending and keeps only Score-bearing ones,
 * ready to feed through applyTxLineEvent in order.
 */
export function parseScoreSnapshot(raw: unknown): TxLineEvent[] {
  const items = z.array(z.unknown()).parse(raw);

  const wires: TxLineWireEvent[] = [];
  for (const item of items) {
    const parsed = txLineWireEventSchema.safeParse(item);
    if (!parsed.success) {
      console.error("Discarding invalid TxLINE snapshot event", parsed.error.message);
      continue;
    }
    wires.push(parsed.data);
  }

  wires.sort((a, b) => a.Seq - b.Seq);

  const events: TxLineEvent[] = [];
  for (const wire of wires) {
    const event = wireEventToTxLineEvent(wire);
    if (event) events.push(event);
  }
  return events;
}

// The `GET /api/fixtures/snapshot` per-fixture shape. The numeric
// `GameState` field is undocumented and unreliable — fixture upserts always
// start `scheduled`; score events move states from there.
export const txLineFixtureSnapshotSchema = z
  .object({
    FixtureId: z.number().int(),
    StartTime: z.number().int().nonnegative(),
    Participant1: z.string().min(1),
    Participant2: z.string().min(1),
    Participant1IsHome: z.boolean(),
  })
  .transform((raw) => ({
    fixtureId: String(raw.FixtureId),
    homeTeam: raw.Participant1IsHome ? raw.Participant1 : raw.Participant2,
    awayTeam: raw.Participant1IsHome ? raw.Participant2 : raw.Participant1,
    startsAt: new Date(raw.StartTime).toISOString(),
    gameState: "scheduled" as FixtureGameState,
    seq: 0,
    stats: {} as FixtureStats,
  }));

export type TxLineFixtureSnapshot = z.infer<typeof txLineFixtureSnapshotSchema>;

export const txLineFixtureListSchema = z.array(txLineFixtureSnapshotSchema);

// One replay file: a fixture-snapshot entry plus its ordered Score-bearing
// events, both in the real wire format. Used by the replay client and the
// fixtures/samples/ files (regenerated from captured devnet data).
export const txLineReplayFileSchema = z
  .object({
    snapshot: txLineFixtureSnapshotSchema,
    events: z.array(txLineEventSchema).min(1),
  })
  .refine(
    (file) => file.events.every((event) => event.fixtureId === file.snapshot.fixtureId),
    { message: "every event must reference the snapshot's FixtureId" },
  )
  .refine(
    (file) =>
      file.events.every((event, index, all) => {
        if (index === 0) return true;
        const previous = all[index - 1];
        return previous !== undefined && event.seq > previous.seq;
      }),
    { message: "events must be strictly increasing by Seq" },
  );

export type TxLineReplayFile = z.infer<typeof txLineReplayFileSchema>;
