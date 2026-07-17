import { describe, expect, it } from "vitest";
import { TEMPLATES, TEMPLATE_IDS, TEMPLATE_OUTCOMES, allowedOutcomes } from "./templates";
import type { GenerationContext } from "./types";

const ctx: GenerationContext = {
  fixtureId: "wc-2026-arg-fra",
  homeTeam: "Argentina",
  awayTeam: "France",
};

const ctxWithBenchmarks: GenerationContext = {
  ...ctx,
  benchmarkFixture: { fixtureId: "wc-2026-bra-ger", totalCorners: 11 },
  teamBenchmark: { fixtureId: "wc-2026-arg-prev", side: "home", goals: 2 },
};

const ctxWithAggregates: GenerationContext = {
  ...ctx,
  lastTen: {
    totalGoals: { average: 3, sampleCount: 10 },
    totalCorners: { average: 9, sampleCount: 10 },
    totalYellowCards: { average: 4, sampleCount: 10 },
  },
  teamLastTen: {
    home: { average: 2, sampleCount: 10 },
    away: { average: 1, sampleCount: 8 },
  },
};

// Every benchmark kind present — used by the registry-wide loops so every
// template (including the aggregate ones whose build() throws without an
// aggregate) can be built.
const ctxFull: GenerationContext = { ...ctxWithBenchmarks, ...ctxWithAggregates };

function sides(rule: { statKey1: string; statKey2: string }): string[] {
  return [rule.statKey1.split(".")[0] ?? "", rule.statKey2.split(".")[0] ?? ""];
}

describe("template registry", () => {
  it("has one definition per declared template id", () => {
    for (const id of TEMPLATE_IDS) {
      expect(TEMPLATES[id].id).toBe(id);
    }
  });

  it("builds deterministically: same context, same result, every time", () => {
    for (const id of TEMPLATE_IDS) {
      const template = TEMPLATES[id];
      if (!template.isAvailable(ctxFull)) continue;
      const first = template.build(ctxFull);
      const second = template.build(ctxFull);
      expect(second).toEqual(first);
    }
  });
});

describe("winner template", () => {
  const template = TEMPLATES.winner;

  it("is always available and never needs a benchmark", () => {
    expect(template.isAvailable(ctx)).toBe(true);
  });

  it("uses Subtract + GreaterThan 0 over full_time goals for both teams", () => {
    const built = template.build(ctx);
    expect(built.tier).toBe("primary");
    expect(built.rule.operator).toBe("subtract");
    expect(built.rule.comparison).toBe("greater_than");
    expect(built.rule.threshold).toBe(0);
    expect(built.rule.period).toBe("full_time");
    expect(sides(built.rule).sort()).toEqual(["away", "home"]);
    expect(built.rule.statKey1.endsWith(".goals")).toBe(true);
    expect(built.rule.statKey2.endsWith(".goals")).toBe(true);
  });

  it("renders copy naming both teams with Yes/No outcomes", () => {
    const built = template.build(ctx);
    expect(built.copy.question).toContain("Argentina");
    expect(built.copy.question).toContain("France");
    expect(built.copy.outcomes).toEqual(["Yes", "No"]);
  });
});

describe("corners_intra template", () => {
  const template = TEMPLATES.corners_intra;

  it("is always available (no benchmark required)", () => {
    expect(template.isAvailable(ctx)).toBe(true);
  });

  it("uses Subtract + GreaterThan 0 over full_time corners", () => {
    const built = template.build(ctx);
    expect(built.tier).toBe("intra");
    expect(built.rule.operator).toBe("subtract");
    expect(built.rule.comparison).toBe("greater_than");
    expect(built.rule.threshold).toBe(0);
    expect(built.rule.statKey1.endsWith(".corners")).toBe(true);
    expect(built.rule.statKey2.endsWith(".corners")).toBe(true);
  });

  it("renders Higher/Lower outcomes", () => {
    expect(template.build(ctx).copy.outcomes).toEqual(["Higher", "Lower"]);
  });
});

describe("period_corners_intra template", () => {
  const template = TEMPLATES.period_corners_intra;

  it("is always available and compares second-half vs first-half corners", () => {
    expect(template.isAvailable(ctx)).toBe(true);
    const built = template.build(ctx);
    expect(built.rule.statKey1).toContain("second_half");
    expect(built.rule.statKey2).toContain("first_half");
    expect(built.rule.statKey1.endsWith(".corners")).toBe(true);
    expect(built.rule.statKey2.endsWith(".corners")).toBe(true);
    expect(built.rule.operator).toBe("subtract");
    expect(built.rule.comparison).toBe("greater_than");
    expect(built.rule.threshold).toBe(0);
    // Spans two periods — the single `period` column doesn't apply.
    expect(built.rule.period).toBeNull();
  });
});

describe("goals_exact_margin template", () => {
  const template = TEMPLATES.goals_exact_margin;

  it("is always available and uses Subtract + Equal N", () => {
    expect(template.isAvailable(ctx)).toBe(true);
    const built = template.build(ctx);
    expect(built.rule.operator).toBe("subtract");
    expect(built.rule.comparison).toBe("equal");
    expect(built.rule.threshold).not.toBeNull();
    expect(built.rule.threshold).toBeGreaterThanOrEqual(1);
    expect(built.rule.statKey1.endsWith(".goals")).toBe(true);
    expect(built.rule.statKey2.endsWith(".goals")).toBe(true);
  });

  it("renders the chosen margin in the copy", () => {
    const built = template.build(ctx);
    expect(built.copy.question).toContain(String(built.rule.threshold));
  });
});

describe("corners_inter_benchmark template", () => {
  const template = TEMPLATES.corners_inter_benchmark;

  it("is unavailable without a completed benchmark fixture", () => {
    expect(template.isAvailable(ctx)).toBe(false);
  });

  it("is available and anchors the benchmark value once a benchmark fixture exists", () => {
    expect(template.isAvailable(ctxWithBenchmarks)).toBe(true);
    const built = template.build(ctxWithBenchmarks);
    expect(built.tier).toBe("inter");
    expect(built.rule.operator).toBe("add");
    expect(built.rule.comparison).toBe("greater_than");
    expect(built.rule.benchmarkFixtureId).toBe("wc-2026-bra-ger");
    expect(built.rule.benchmarkValue).toBe(11);
    expect(built.rule.statKey1.endsWith(".corners")).toBe(true);
    expect(built.rule.statKey2.endsWith(".corners")).toBe(true);
    expect(built.copy.question).toContain("11");
  });
});

describe("team_goals_inter_benchmark template", () => {
  const template = TEMPLATES.team_goals_inter_benchmark;

  it("is unavailable without a team benchmark", () => {
    expect(template.isAvailable(ctx)).toBe(false);
  });

  it("anchors the benchmarked team's previous goals and compares this fixture's same side", () => {
    expect(template.isAvailable(ctxWithBenchmarks)).toBe(true);
    const built = template.build(ctxWithBenchmarks);
    expect(built.tier).toBe("inter");
    expect(built.rule.statKey1).toBe("home.full_time.goals");
    expect(built.rule.benchmarkFixtureId).toBe("wc-2026-arg-prev");
    expect(built.rule.benchmarkValue).toBe(2);
    expect(built.copy.question).toContain("Argentina");
    expect(built.copy.question).toContain("2");
  });
});

describe("yellow_cards_intra template", () => {
  const template = TEMPLATES.yellow_cards_intra;

  it("requires a clear benchmark (either benchmark kind) to be available", () => {
    expect(template.isAvailable(ctx)).toBe(false);
    expect(template.isAvailable(ctxWithBenchmarks)).toBe(true);
  });

  it("compares full_time yellow cards between the two teams", () => {
    const built = template.build(ctxWithBenchmarks);
    expect(built.rule.statKey1.endsWith(".yellowCards")).toBe(true);
    expect(built.rule.statKey2.endsWith(".yellowCards")).toBe(true);
  });
});

describe("red_cards_intra template", () => {
  const template = TEMPLATES.red_cards_intra;

  it("requires both benchmark kinds — stricter than yellow cards", () => {
    expect(template.isAvailable(ctx)).toBe(false);
    expect(template.isAvailable(ctxWithBenchmarks)).toBe(true);
  });

  it("is unavailable with only one benchmark kind, unlike yellow cards", () => {
    const onlyFixtureBenchmark = { ...ctx, benchmarkFixture: ctxWithBenchmarks.benchmarkFixture };
    expect(TEMPLATES.yellow_cards_intra.isAvailable(onlyFixtureBenchmark)).toBe(true);
    expect(template.isAvailable(onlyFixtureBenchmark)).toBe(false);
  });

  it("compares full_time red cards between the two teams", () => {
    const built = template.build(ctxWithBenchmarks);
    expect(built.rule.statKey1.endsWith(".redCards")).toBe(true);
    expect(built.rule.statKey2.endsWith(".redCards")).toBe(true);
  });
});

describe.each([
  ["total_goals_last10", "goals", "totalGoals", 3] as const,
  ["total_corners_last10", "corners", "totalCorners", 9] as const,
  ["total_yellow_cards_last10", "yellowCards", "totalYellowCards", 4] as const,
])("%s template (last-10 higher/lower)", (id, stat, metric, average) => {
  const template = TEMPLATES[id];

  it("is unavailable without its last-10 aggregate", () => {
    expect(template.isAvailable(ctx)).toBe(false);
    const missing: GenerationContext = {
      ...ctxWithAggregates,
      lastTen: { ...ctxWithAggregates.lastTen!, [metric]: null },
    };
    expect(template.isAvailable(missing)).toBe(false);
  });

  it("anchors the aggregate average with an add + greater_than, no fixture id", () => {
    expect(template.isAvailable(ctxWithAggregates)).toBe(true);
    const built = template.build(ctxWithAggregates);
    expect(built.tier).toBe("inter");
    expect(built.rule.operator).toBe("add");
    expect(built.rule.comparison).toBe("greater_than");
    expect(built.rule.threshold).toBeNull();
    expect(built.rule.benchmarkFixtureId).toBeNull();
    expect(built.rule.benchmarkValue).toBe(average);
    expect(built.rule.statKey1).toBe(`home.full_time.${stat}`);
    expect(built.rule.statKey2).toBe(`away.full_time.${stat}`);
    expect(sides(built.rule).sort()).toEqual(["away", "home"]);
    expect(built.copy.outcomes).toEqual(["Higher", "Lower"]);
    expect(built.copy.question).toContain(String(average));
  });
});

describe.each([
  ["team_goals_last10_home", "home", 2] as const,
  ["team_goals_last10_away", "away", 1] as const,
])("%s template (team last-10 yes/no)", (id, side, average) => {
  const template = TEMPLATES[id];

  it("is unavailable without that side's last-10 aggregate", () => {
    expect(template.isAvailable(ctx)).toBe(false);
    const missing: GenerationContext = {
      ...ctxWithAggregates,
      teamLastTen: { ...ctxWithAggregates.teamLastTen!, [side]: null },
    };
    expect(template.isAvailable(missing)).toBe(false);
  });

  it("compares the side's goals against its stored average via the benchmark sentinel", () => {
    expect(template.isAvailable(ctxWithAggregates)).toBe(true);
    const built = template.build(ctxWithAggregates);
    expect(built.rule.statKey1).toBe(`${side}.full_time.goals`);
    expect(built.rule.statKey2).toBe("benchmark");
    expect(built.rule.operator).toBe("subtract");
    expect(built.rule.comparison).toBe("greater_than");
    expect(built.rule.threshold).toBeNull();
    expect(built.rule.benchmarkFixtureId).toBeNull();
    expect(built.rule.benchmarkValue).toBe(average);
    expect(built.copy.outcomes).toEqual(["Yes", "No"]);
    expect(built.copy.question).toContain(String(average));
  });
});

describe("period_goals_intra template", () => {
  const template = TEMPLATES.period_goals_intra;

  it("is always available and compares second-half vs first-half goals", () => {
    expect(template.isAvailable(ctx)).toBe(true);
    const built = template.build(ctx);
    expect(built.rule.statKey1).toBe("total.second_half.goals");
    expect(built.rule.statKey2).toBe("total.first_half.goals");
    expect(built.rule.operator).toBe("subtract");
    expect(built.rule.comparison).toBe("greater_than");
    expect(built.rule.threshold).toBe(0);
    expect(built.rule.period).toBeNull();
    expect(built.copy.outcomes).toEqual(["Higher", "Lower"]);
  });
});

describe("red_card_occurrence template", () => {
  const template = TEMPLATES.red_card_occurrence;

  it("is always available (no benchmark data needed)", () => {
    expect(template.isAvailable(ctx)).toBe(true);
  });

  it("encodes 'any red card' as redCards minus a constant-0 benchmark, greater_than", () => {
    const built = template.build(ctx);
    expect(built.rule.statKey1).toBe("total.full_time.redCards");
    expect(built.rule.statKey2).toBe("benchmark");
    expect(built.rule.operator).toBe("subtract");
    expect(built.rule.comparison).toBe("greater_than");
    expect(built.rule.threshold).toBeNull();
    expect(built.rule.benchmarkValue).toBe(0);
    expect(built.rule.benchmarkFixtureId).toBeNull();
    expect(built.copy.outcomes).toEqual(["Yes", "No"]);
  });
});

describe("TEMPLATE_OUTCOMES", () => {
  it("matches each template's rendered copy outcomes, lowercased", () => {
    for (const id of TEMPLATE_IDS) {
      const built = TEMPLATES[id].build(ctxFull);
      expect(TEMPLATE_OUTCOMES[id]).toEqual(
        built.copy.outcomes.map((outcome) => outcome.toLowerCase()),
      );
    }
  });

  it("returns null for an unknown template id", () => {
    expect(allowedOutcomes("winner")).toEqual(["yes", "no"]);
    expect(allowedOutcomes("not-a-template")).toBeNull();
  });
});
