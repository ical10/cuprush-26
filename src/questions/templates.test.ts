import { describe, expect, it } from "vitest";
import { TEMPLATES, TEMPLATE_IDS } from "./templates";
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
      if (!template.isAvailable(ctxWithBenchmarks)) continue;
      const first = template.build(ctxWithBenchmarks);
      const second = template.build(ctxWithBenchmarks);
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
