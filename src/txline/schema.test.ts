import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseScoreSnapshot,
  txLineEventSchema,
  txLineFixtureListSchema,
  txLineFixtureSnapshotSchema,
  txLineReplayFileSchema,
  txLineWireEventSchema,
  wireEventToTxLineEvent,
} from "./schema";

async function readCaptured(name: string): Promise<unknown> {
  const raw = await readFile(new URL(`./fixtures/captured/${name}`, import.meta.url), "utf8");
  return JSON.parse(raw);
}

const zeroTeam = { goals: 0, yellowCards: 0, redCards: 0, corners: 0 };

const wireGoalEvent = {
  FixtureId: 18192996,
  Seq: 384,
  Ts: 1783303081000,
  Action: "goal",
  Confirmed: true,
  Participant1IsHome: true,
  Score: {
    Participant1: {
      H1: { Goals: 1, Corners: 2 },
      HT: { Goals: 1, Corners: 2 },
      Total: { Goals: 1, Corners: 2 },
    },
    Participant2: {
      H1: { Goals: 2, YellowCards: 1, Corners: 2 },
      HT: { Goals: 2, YellowCards: 1, Corners: 2 },
      Total: { Goals: 2, YellowCards: 1, Corners: 2 },
    },
  },
};

const wireSnapshotEntry = {
  Ts: 1783339200000,
  StartTime: 1783299600000,
  Competition: "World Cup",
  CompetitionId: 72,
  FixtureGroupId: 10115574,
  Participant1Id: 2545,
  Participant1: "Mexico",
  Participant2Id: 1888,
  Participant2: "England",
  FixtureId: 18192996,
  Participant1IsHome: true,
  GameState: 3,
};

describe("txLineEventSchema", () => {
  it("transforms a real goal event to the normalized camelCase shape", () => {
    const result = txLineEventSchema.parse(wireGoalEvent);

    expect(result).toEqual({
      fixtureId: "18192996",
      seq: 384,
      type: "goal",
      gameState: "live",
      occurredAt: new Date(1783303081000).toISOString(),
      stats: {
        full_time: {
          home: { goals: 1, yellowCards: 0, redCards: 0, corners: 2 },
          away: { goals: 2, yellowCards: 1, redCards: 0, corners: 2 },
        },
        first_half: {
          home: { goals: 1, yellowCards: 0, redCards: 0, corners: 2 },
          away: { goals: 2, yellowCards: 1, redCards: 0, corners: 2 },
        },
      },
    });
  });

  it("ignores the HT period entirely", () => {
    const result = txLineEventSchema.parse(wireGoalEvent);
    expect(Object.keys(result.stats).sort()).toEqual(["first_half", "full_time"]);
  });

  it("swaps home/away when Participant1IsHome is false", () => {
    const result = txLineEventSchema.parse({ ...wireGoalEvent, Participant1IsHome: false });

    expect(result.stats.full_time).toEqual({
      home: { goals: 2, yellowCards: 1, redCards: 0, corners: 2 },
      away: { goals: 1, yellowCards: 0, redCards: 0, corners: 2 },
    });
  });

  it("defaults sparse Score fields to 0", () => {
    const result = txLineEventSchema.parse({
      ...wireGoalEvent,
      Action: "red_card",
      Score: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { H2: { RedCards: 1 }, Total: { RedCards: 1 } },
      },
    });

    expect(result.stats).toEqual({
      full_time: {
        home: { goals: 1, yellowCards: 0, redCards: 0, corners: 0 },
        away: { goals: 0, yellowCards: 0, redCards: 1, corners: 0 },
      },
      second_half: {
        home: zeroTeam,
        away: { goals: 0, yellowCards: 0, redCards: 1, corners: 0 },
      },
    });
  });

  it("defaults a missing participant to all-zero stats", () => {
    const result = txLineEventSchema.parse({
      ...wireGoalEvent,
      Score: { Participant1: { Total: { Goals: 1 } } },
    });

    expect(result.stats.full_time?.away).toEqual(zeroTeam);
  });

  it("maps game_finalised to gameState finished", () => {
    const result = txLineEventSchema.parse({ ...wireGoalEvent, Action: "game_finalised" });

    expect(result.gameState).toBe("finished");
    expect(result.type).toBe("state_change");
  });

  it("tolerates unknown Action values that carry a Score", () => {
    const result = txLineEventSchema.parse({ ...wireGoalEvent, Action: "brand_new_action" });

    expect(result.type).toBe("state_change");
    expect(result.gameState).toBe("live");
    expect(result.stats.full_time?.home.goals).toBe(1);
  });

  it("maps card and corner actions to their own event types", () => {
    for (const action of ["yellow_card", "red_card", "corner"] as const) {
      expect(txLineEventSchema.parse({ ...wireGoalEvent, Action: action }).type).toBe(action);
    }
  });

  it("rejects an event without a Score object", () => {
    const noScore: Record<string, unknown> = { ...wireGoalEvent };
    delete noScore.Score;
    expect(() => txLineEventSchema.parse(noScore)).toThrow();
  });

  it("rejects a negative Seq", () => {
    expect(() => txLineEventSchema.parse({ ...wireGoalEvent, Seq: -1 })).toThrow();
  });

  it("rejects negative stat totals", () => {
    expect(() =>
      txLineEventSchema.parse({
        ...wireGoalEvent,
        Score: { Participant1: { Total: { Goals: -1 } }, Participant2: {} },
      }),
    ).toThrow();
  });
});

describe("txLineWireEventSchema / wireEventToTxLineEvent", () => {
  it("accepts an informational event without Score and converts it to null", () => {
    const wire = txLineWireEventSchema.parse({
      FixtureId: 18193785,
      Seq: 1,
      Ts: 1782958462911,
      Action: "comment",
      Participant1IsHome: true,
    });

    expect(wireEventToTxLineEvent(wire)).toBeNull();
  });

  it("converts a Score-bearing event to a TxLineEvent", () => {
    const wire = txLineWireEventSchema.parse(wireGoalEvent);
    const event = wireEventToTxLineEvent(wire);

    expect(event?.fixtureId).toBe("18192996");
    expect(event?.seq).toBe(384);
    expect(event?.stats.full_time?.away.goals).toBe(2);
  });
});

describe("txLineFixtureSnapshotSchema", () => {
  it("transforms a real fixture entry, ignoring the numeric GameState", () => {
    const result = txLineFixtureSnapshotSchema.parse(wireSnapshotEntry);

    expect(result).toEqual({
      fixtureId: "18192996",
      homeTeam: "Mexico",
      awayTeam: "England",
      startsAt: "2026-07-06T01:00:00.000Z",
      gameState: "scheduled",
      seq: 0,
      stats: {},
      competition: "World Cup",
      competitionId: 72,
    });
  });

  it("tolerates absent Competition/CompetitionId, defaulting both to null", () => {
    const { Competition, CompetitionId, ...withoutCompetition } = wireSnapshotEntry;
    void Competition;
    void CompetitionId;

    const result = txLineFixtureSnapshotSchema.parse(withoutCompetition);

    expect(result.competition).toBeNull();
    expect(result.competitionId).toBeNull();
  });

  it("swaps team names when Participant1IsHome is false", () => {
    const result = txLineFixtureSnapshotSchema.parse({
      ...wireSnapshotEntry,
      Participant1IsHome: false,
    });

    expect(result.homeTeam).toBe("England");
    expect(result.awayTeam).toBe("Mexico");
  });

  it("parses the full captured fixtures snapshot", async () => {
    const result = txLineFixtureListSchema.parse(await readCaptured("fixtures-snapshot.json"));

    expect(result).toHaveLength(10);
    expect(result.every((fixture) => fixture.gameState === "scheduled")).toBe(true);
    const usa = result.find((fixture) => fixture.fixtureId === "18193785");
    expect(usa).toMatchObject({
      homeTeam: "USA",
      awayTeam: "Belgium",
      competition: "World Cup",
      competitionId: 72,
    });
  });
});

describe("parseScoreSnapshot", () => {
  it("sorts the unordered captured snapshot by Seq and keeps only Score-bearing events", async () => {
    const events = parseScoreSnapshot(await readCaptured("scores-snapshot-18192996.json"));

    expect(events).toHaveLength(11);
    const seqs = events.map((event) => event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs[0]).toBe(384);
    expect(seqs.at(-1)).toBe(1046);
    expect(events.at(-1)?.gameState).toBe("finished");
    expect(events.every((event) => event.fixtureId === "18192996")).toBe(true);
  });

  it("returns no events for a snapshot with only informational actions", async () => {
    const events = parseScoreSnapshot(await readCaptured("scores-snapshot-18193785.json"));
    expect(events).toEqual([]);
  });

  it("applies the final cumulative score of the finished captured match", async () => {
    const events = parseScoreSnapshot(await readCaptured("scores-snapshot-18192996.json"));
    const final = events.at(-1);

    expect(final?.stats.full_time).toEqual({
      home: { goals: 2, yellowCards: 2, redCards: 0, corners: 12 },
      away: { goals: 3, yellowCards: 3, redCards: 1, corners: 2 },
    });
  });
});

describe("txLineReplayFileSchema", () => {
  const replayFile = {
    snapshot: wireSnapshotEntry,
    events: [wireGoalEvent, { ...wireGoalEvent, Seq: 385 }],
  };

  it("accepts a snapshot with strictly increasing events for the same fixture", () => {
    const result = txLineReplayFileSchema.parse(replayFile);
    expect(result.events.map((event) => event.seq)).toEqual([384, 385]);
    expect(result.snapshot.fixtureId).toBe("18192996");
  });

  it("rejects an event referencing a different fixture", () => {
    expect(() =>
      txLineReplayFileSchema.parse({
        ...replayFile,
        events: [{ ...wireGoalEvent, FixtureId: 999 }],
      }),
    ).toThrow();
  });

  it("rejects events that are not strictly increasing by Seq", () => {
    expect(() =>
      txLineReplayFileSchema.parse({
        ...replayFile,
        events: [wireGoalEvent, wireGoalEvent],
      }),
    ).toThrow();
  });
});
