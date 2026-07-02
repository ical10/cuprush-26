import { describe, expect, it } from "vitest";
import {
  txLineEventSchema,
  txLineFixtureSnapshotSchema,
  txLineReplayFileSchema,
} from "./schema";

const validStats = {
  full_time: {
    home: { goals: 1, yellow_cards: 0, red_cards: 0, corners: 3 },
    away: { goals: 0, yellow_cards: 1, red_cards: 0, corners: 2 },
  },
};

const validEvent = {
  fixture_id: "wc-2026-arg-fra",
  seq: 1,
  type: "goal",
  game_state: "live",
  occurred_at: "2026-07-19T15:23:00.000Z",
  stats: validStats,
};

const validSnapshot = {
  fixture_id: "wc-2026-arg-fra",
  home_team: "Argentina",
  away_team: "France",
  starts_at: "2026-07-19T15:00:00.000Z",
  game_state: "scheduled",
  seq: 0,
  stats: {
    full_time: {
      home: { goals: 0, yellow_cards: 0, red_cards: 0, corners: 0 },
      away: { goals: 0, yellow_cards: 0, red_cards: 0, corners: 0 },
    },
  },
};

describe("txLineEventSchema", () => {
  it("accepts a valid goal event and normalizes it to camelCase", () => {
    const result = txLineEventSchema.parse(validEvent);

    expect(result).toEqual({
      fixtureId: "wc-2026-arg-fra",
      seq: 1,
      type: "goal",
      gameState: "live",
      occurredAt: "2026-07-19T15:23:00.000Z",
      stats: {
        full_time: {
          home: { goals: 1, yellowCards: 0, redCards: 0, corners: 3 },
          away: { goals: 0, yellowCards: 1, redCards: 0, corners: 2 },
        },
      },
    });
  });

  it("accepts optional first_half/second_half period breakdowns", () => {
    const result = txLineEventSchema.parse({
      ...validEvent,
      stats: {
        ...validStats,
        first_half: validStats.full_time,
      },
    });

    expect(result.stats.first_half).toEqual({
      home: { goals: 1, yellowCards: 0, redCards: 0, corners: 3 },
      away: { goals: 0, yellowCards: 1, redCards: 0, corners: 2 },
    });
  });

  it("rejects a negative seq", () => {
    expect(() => txLineEventSchema.parse({ ...validEvent, seq: -1 })).toThrow();
  });

  it("rejects an unknown event type", () => {
    expect(() => txLineEventSchema.parse({ ...validEvent, type: "penalty_shootout" })).toThrow();
  });

  it("rejects an unknown game_state", () => {
    expect(() => txLineEventSchema.parse({ ...validEvent, game_state: "halftime" })).toThrow();
  });

  it("rejects a non-ISO occurred_at", () => {
    expect(() => txLineEventSchema.parse({ ...validEvent, occurred_at: "not-a-date" })).toThrow();
  });

  it("rejects negative stat totals", () => {
    expect(() =>
      txLineEventSchema.parse({
        ...validEvent,
        stats: {
          full_time: {
            home: { goals: -1, yellow_cards: 0, red_cards: 0, corners: 0 },
            away: { goals: 0, yellow_cards: 0, red_cards: 0, corners: 0 },
          },
        },
      }),
    ).toThrow();
  });

  it("rejects a missing fixture_id", () => {
    const rest: Record<string, unknown> = { ...validEvent };
    delete rest.fixture_id;
    expect(() => txLineEventSchema.parse(rest)).toThrow();
  });

  it("rejects stats missing full_time", () => {
    expect(() => txLineEventSchema.parse({ ...validEvent, stats: {} })).toThrow();
  });
});

describe("txLineFixtureSnapshotSchema", () => {
  it("accepts a valid snapshot and normalizes it to camelCase", () => {
    const result = txLineFixtureSnapshotSchema.parse(validSnapshot);

    expect(result).toMatchObject({
      fixtureId: "wc-2026-arg-fra",
      homeTeam: "Argentina",
      awayTeam: "France",
      startsAt: "2026-07-19T15:00:00.000Z",
      gameState: "scheduled",
      seq: 0,
    });
  });

  it("rejects a malformed starts_at", () => {
    expect(() =>
      txLineFixtureSnapshotSchema.parse({ ...validSnapshot, starts_at: "19 July 2026" }),
    ).toThrow();
  });
});

describe("txLineReplayFileSchema", () => {
  it("accepts a snapshot with strictly increasing events for the same fixture", () => {
    const result = txLineReplayFileSchema.parse({
      snapshot: validSnapshot,
      events: [validEvent, { ...validEvent, seq: 2 }],
    });

    expect(result.events.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("rejects an event referencing a different fixture", () => {
    expect(() =>
      txLineReplayFileSchema.parse({
        snapshot: validSnapshot,
        events: [{ ...validEvent, fixture_id: "some-other-fixture" }],
      }),
    ).toThrow();
  });

  it("rejects events that are not strictly increasing by seq", () => {
    expect(() =>
      txLineReplayFileSchema.parse({
        snapshot: validSnapshot,
        events: [{ ...validEvent, seq: 2 }, { ...validEvent, seq: 2 }],
      }),
    ).toThrow();
  });
});
