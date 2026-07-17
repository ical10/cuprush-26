import { describe, expect, it } from "vitest";
import type { fixtures } from "../db/schema";
import { computeAverages, computeTeamGoalsAverage } from "./benchmarks";

type FixtureRow = typeof fixtures.$inferSelect;

let counter = 0;

function makeRow(overrides: Partial<FixtureRow> = {}): FixtureRow {
  counter += 1;
  return {
    id: `fixture-${counter}`,
    homeTeam: "Argentina",
    awayTeam: "France",
    startsAt: new Date(2026, 5, counter),
    gameState: "finished",
    stage: "group",
    lastSeq: 0,
    stats: {},
    createdAt: new Date(2026, 5, counter),
    ...overrides,
  };
}

function withFullTime(
  overrides: Partial<FixtureRow> = {},
  home: { goals: number; yellowCards: number; redCards: number; corners: number },
  away: { goals: number; yellowCards: number; redCards: number; corners: number },
): FixtureRow {
  return makeRow({ ...overrides, stats: { full_time: { home, away } } });
}

describe("computeAverages", () => {
  it("averages total goals, corners, and yellow cards across qualifying rows", () => {
    const rows = [
      withFullTime({}, { goals: 2, yellowCards: 1, redCards: 0, corners: 5 }, { goals: 1, yellowCards: 2, redCards: 0, corners: 4 }),
      withFullTime({}, { goals: 1, yellowCards: 0, redCards: 0, corners: 3 }, { goals: 1, yellowCards: 1, redCards: 0, corners: 3 }),
      withFullTime({}, { goals: 0, yellowCards: 1, redCards: 0, corners: 2 }, { goals: 2, yellowCards: 0, redCards: 0, corners: 4 }),
    ];

    const result = computeAverages(rows, 10);

    expect(result.totalGoals).toEqual({ average: 2, sampleCount: 3 });
    expect(result.totalCorners).toEqual({ average: 7, sampleCount: 3 });
    expect(result.totalYellowCards).toEqual({ average: 2, sampleCount: 3 });
  });

  it("rounds the average with Math.round (half rounds up)", () => {
    const rows = [
      withFullTime({}, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 0, yellowCards: 0, redCards: 0, corners: 0 }),
      withFullTime({}, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 0, yellowCards: 0, redCards: 0, corners: 0 }),
      withFullTime({}, { goals: 2, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 0, yellowCards: 0, redCards: 0, corners: 0 }),
    ];

    // sum = 1 + 1 + 2 = 4, count = 3, 4/3 = 1.333... -> rounds to 1
    expect(computeAverages(rows, 10).totalGoals).toEqual({ average: 1, sampleCount: 3 });
  });

  it("returns null for a metric with fewer than 3 qualifying fixtures", () => {
    const rows = [
      withFullTime({}, { goals: 2, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }),
      withFullTime({}, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }),
    ];

    const result = computeAverages(rows, 10);

    expect(result.totalGoals).toBeNull();
    expect(result.totalCorners).toBeNull();
    expect(result.totalYellowCards).toBeNull();
  });

  it("excludes fixtures missing full_time stats from the qualifying count", () => {
    const rows = [
      withFullTime({}, { goals: 2, yellowCards: 0, redCards: 0, corners: 5 }, { goals: 1, yellowCards: 0, redCards: 0, corners: 4 }),
      withFullTime({}, { goals: 1, yellowCards: 0, redCards: 0, corners: 3 }, { goals: 1, yellowCards: 0, redCards: 0, corners: 3 }),
      makeRow(), // stats: {} — no full_time
    ];

    expect(computeAverages(rows, 10).totalGoals).toBeNull();
  });

  it("only counts the first `limit` rows even when more rows are passed in", () => {
    const qualifying = [
      withFullTime({}, { goals: 2, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 0, yellowCards: 0, redCards: 0, corners: 0 }),
      withFullTime({}, { goals: 2, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 0, yellowCards: 0, redCards: 0, corners: 0 }),
      withFullTime({}, { goals: 2, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 0, yellowCards: 0, redCards: 0, corners: 0 }),
    ];
    // A 4th row that would change the average if it were counted.
    const extra = withFullTime({}, { goals: 100, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 0, yellowCards: 0, redCards: 0, corners: 0 });

    const result = computeAverages([...qualifying, extra], 3);

    expect(result.totalGoals).toEqual({ average: 2, sampleCount: 3 });
  });
});

describe("computeTeamGoalsAverage", () => {
  it("picks the home-side goals when the team played at home", () => {
    const rows = [
      withFullTime({ homeTeam: "Argentina", awayTeam: "Mexico" }, { goals: 3, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }),
      withFullTime({ homeTeam: "Argentina", awayTeam: "Brazil" }, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }),
      withFullTime({ homeTeam: "Argentina", awayTeam: "Chile" }, { goals: 2, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 0, yellowCards: 0, redCards: 0, corners: 0 }),
    ];

    expect(computeTeamGoalsAverage(rows, 10, "Argentina")).toEqual({ average: 2, sampleCount: 3 });
  });

  it("picks the away-side goals when the team played away", () => {
    const rows = [
      withFullTime({ homeTeam: "Mexico", awayTeam: "Argentina" }, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 3, yellowCards: 0, redCards: 0, corners: 0 }),
      withFullTime({ homeTeam: "Brazil", awayTeam: "Argentina" }, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }),
      withFullTime({ homeTeam: "Chile", awayTeam: "Argentina" }, { goals: 0, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 2, yellowCards: 0, redCards: 0, corners: 0 }),
    ];

    expect(computeTeamGoalsAverage(rows, 10, "Argentina")).toEqual({ average: 2, sampleCount: 3 });
  });

  it("mixes home and away rows for the same team correctly", () => {
    const rows = [
      withFullTime({ homeTeam: "Argentina", awayTeam: "Mexico" }, { goals: 3, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }),
      withFullTime({ homeTeam: "Brazil", awayTeam: "Argentina" }, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 3, yellowCards: 0, redCards: 0, corners: 0 }),
      withFullTime({ homeTeam: "Argentina", awayTeam: "Chile" }, { goals: 0, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 0, yellowCards: 0, redCards: 0, corners: 0 }),
    ];

    expect(computeTeamGoalsAverage(rows, 10, "Argentina")).toEqual({ average: 2, sampleCount: 3 });
  });

  it("returns null with fewer than 3 qualifying fixtures", () => {
    const rows = [
      withFullTime({ homeTeam: "Argentina", awayTeam: "Mexico" }, { goals: 3, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }),
      withFullTime({ homeTeam: "Argentina", awayTeam: "Brazil" }, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }, { goals: 1, yellowCards: 0, redCards: 0, corners: 0 }),
    ];

    expect(computeTeamGoalsAverage(rows, 10, "Argentina")).toBeNull();
  });
});
