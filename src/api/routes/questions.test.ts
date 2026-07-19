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
  competitionId: null,
  competition: null,
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
    // Raw canonical values, not display labels — this is what the client
    // submits back to POST /api/predictions.
    expect(copy.outcomes).toEqual(["yes", "no"]);
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
    expect(copy.outcomes).toEqual(["higher", "lower"]);
  });

  it("renders an inter-fixture corners benchmark question", () => {
    const copy = renderCopy(
      question({ template: "corners_inter_benchmark", benchmarkValue: 11 }),
      fixture,
    );
    expect(copy.text).toContain("11 total corners");
    expect(copy.outcomes).toEqual(["higher", "lower"]);
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

  it("renders a last-10 aggregate higher/lower question with its metric label", () => {
    const copy = renderCopy(
      question({
        template: "total_corners_last10",
        statKey1: "home.full_time.corners",
        statKey2: "away.full_time.corners",
        operator: "add",
        threshold: null,
        benchmarkValue: 9,
      }),
      fixture,
    );
    expect(copy.text).toBe(
      "Last 10 matches averaged 9 corners. Will this match finish Higher or Lower?",
    );
    expect(copy.outcomes).toEqual(["higher", "lower"]);
  });

  it("renders a team last-10 goals benchmark question", () => {
    const copy = renderCopy(
      question({
        template: "team_goals_last10_home",
        statKey1: "home.full_time.goals",
        statKey2: "benchmark",
        threshold: null,
        benchmarkValue: 2,
      }),
      fixture,
    );
    expect(copy.text).toBe(
      "Will Argentina score more goals than their last-10 average (2)?",
    );
    expect(copy.outcomes).toEqual(["yes", "no"]);
  });

  it("renders the second-half vs first-half goals question", () => {
    const copy = renderCopy(
      question({
        template: "period_goals_intra",
        statKey1: "total.second_half.goals",
        statKey2: "total.first_half.goals",
        period: null,
      }),
      fixture,
    );
    expect(copy.text).toBe("Will second-half goals beat first-half goals?");
    expect(copy.outcomes).toEqual(["higher", "lower"]);
  });

  it("renders the red-card occurrence question", () => {
    const copy = renderCopy(
      question({
        template: "red_card_occurrence",
        statKey1: "total.full_time.redCards",
        statKey2: "benchmark",
        threshold: null,
        benchmarkValue: 0,
      }),
      fixture,
    );
    expect(copy.text).toBe("Will there be a red card in this match?");
    expect(copy.outcomes).toEqual(["yes", "no"]);
  });
});
