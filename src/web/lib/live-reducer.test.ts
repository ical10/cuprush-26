import { describe, expect, it } from "vitest";
import { initialLiveState, liveReducer, parseFixtureUpdate } from "./live-reducer";
import type { FixtureUpdate } from "./types";

const base: FixtureUpdate = {
  fixtureId: "fx-1",
  seq: 1,
  gameState: "live",
  stats: {},
};

describe("liveReducer", () => {
  it("stores the first update for a fixture", () => {
    const state = liveReducer(initialLiveState, { type: "snapshot", update: base });
    expect(state["fx-1"]).toEqual(base);
  });

  it("applies a newer sequence", () => {
    const state1 = liveReducer(initialLiveState, { type: "snapshot", update: base });
    const newer = { ...base, seq: 2, gameState: "finished" as const };
    const state2 = liveReducer(state1, { type: "update", update: newer });
    expect(state2["fx-1"]).toEqual(newer);
  });

  it("ignores a duplicate or older sequence", () => {
    const state1 = liveReducer(initialLiveState, { type: "snapshot", update: { ...base, seq: 5 } });
    const stale = { ...base, seq: 3 };
    const state2 = liveReducer(state1, { type: "update", update: stale });
    expect(state2["fx-1"]?.seq).toBe(5);
  });

  it("leaves other fixtures untouched", () => {
    const state1 = liveReducer(initialLiveState, { type: "snapshot", update: base });
    const other = { ...base, fixtureId: "fx-2" };
    const state2 = liveReducer(state1, { type: "snapshot", update: other });
    expect(Object.keys(state2)).toEqual(["fx-1", "fx-2"]);
  });
});

describe("parseFixtureUpdate", () => {
  it("parses a valid payload", () => {
    expect(parseFixtureUpdate(JSON.stringify(base))).toEqual(base);
  });

  it("returns null for malformed JSON", () => {
    expect(parseFixtureUpdate("{not json")).toBeNull();
  });

  it("returns null for a payload missing required fields", () => {
    expect(parseFixtureUpdate(JSON.stringify({ fixtureId: "fx-1" }))).toBeNull();
  });
});
