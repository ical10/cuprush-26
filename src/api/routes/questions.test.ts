import { describe, expect, it } from "vitest";
import { renderCopy } from "./questions";
import type { fixtures, questions } from "../../db/schema";

type QuestionRow = typeof questions.$inferSelect;
type FixtureRow = typeof fixtures.$inferSelect;

const fixture: FixtureRow = {
  id: "fx-1",
  homeTeam: "Argentina",
  awayTeam: "Brazil",
  startsAt: new Date(),
  gameState: "scheduled",
  stage: "group",
  lastSeq: 0,
  stats: {},
  createdAt: new Date(),
};

function question(overrides: Partial<QuestionRow>): QuestionRow {
  return {
    id: "q-1",
    fixtureId: "fx-1",
    benchmarkFixtureId: null,
    template: "winner",
    statKey1: "home.full_time.goals",
    statKey2: "away.full_time.goals",
    period: "full_time",
    operator: "subtract",
    comparison: "greater_than",
    threshold: 0,
    benchmarkValue: null,
    status: "open",
    result: null,
    opensAt: new Date(),
    locksAt: new Date(),
    settlingAt: null,
    settledAt: null,
    attemptCount: 0,
    nextRetryAt: null,
    lastError: null,
    questionPda: null,
    settlementSignature: null,
    ruleHash: "hash",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("renderCopy", () => {
  it("renders the winner question with team names and Yes/No outcomes", () => {
    const copy = renderCopy(question({}), fixture);
    expect(copy.text).toBe("Will Argentina score more goals than Brazil?");
    expect(copy.outcomes).toEqual(["Yes", "No"]);
  });

  it("renders an intra-fixture stat comparison with Higher/Lower outcomes", () => {
    const copy = renderCopy(
      question({
        template: "corners_intra",
        statKey1: "home.full_time.corners",
        statKey2: "away.full_time.corners",
      }),
      fixture,
    );
    expect(copy.text).toBe("Will Argentina have more corners than Brazil?");
    expect(copy.outcomes).toEqual(["Higher", "Lower"]);
  });

  it("renders an inter-fixture corners benchmark question", () => {
    const copy = renderCopy(
      question({ template: "corners_inter_benchmark", benchmarkValue: 11 }),
      fixture,
    );
    expect(copy.text).toContain("11 total corners");
    expect(copy.outcomes).toEqual(["Higher", "Lower"]);
  });

  it("renders an exact-margin goals question", () => {
    const copy = renderCopy(
      question({ template: "goals_exact_margin", threshold: 2 }),
      fixture,
    );
    expect(copy.text).toBe(
      "Will Argentina score exactly 2 more goals than Brazil?",
    );
  });
});
