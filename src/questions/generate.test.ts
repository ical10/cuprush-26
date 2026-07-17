import { describe, expect, it } from "vitest";
import { HARD_CAP_TOTAL_CARDS } from "./stage-budget";
import { SECONDARY_CATEGORIES, generateQuestionRules } from "./generate";
import type { GenerationContext } from "./types";

const ctx: GenerationContext = {
  fixtureId: "wc-2026-arg-fra",
  homeTeam: "Argentina",
  awayTeam: "France",
};

// Every benchmark kind present: single-fixture benchmarks *and* the last-10
// aggregates, so all 11 secondary categories are available.
const richCtx: GenerationContext = {
  ...ctx,
  benchmarkFixture: { fixtureId: "wc-2026-bra-ger", totalCorners: 11 },
  teamBenchmark: { fixtureId: "wc-2026-arg-prev", side: "home", goals: 2 },
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

// Only the single-fixture benchmarks, no last-10 aggregates — the old
// benchmark templates should still surface as within-category fallbacks.
const legacyBenchmarkCtx: GenerationContext = {
  ...ctx,
  benchmarkFixture: { fixtureId: "wc-2026-bra-ger", totalCorners: 11 },
  teamBenchmark: { fixtureId: "wc-2026-arg-prev", side: "home", goals: 2 },
};

describe("generateQuestionRules", () => {
  it("always includes exactly one winner card first", () => {
    const rules = generateQuestionRules(ctx, "group");
    expect(rules[0]?.templateId).toBe("winner");
    expect(rules.filter((r) => r.templateId === "winner")).toHaveLength(1);
  });

  it("is deterministic: same fixture + stage always produces identical questions", () => {
    const a = generateQuestionRules(richCtx, "final");
    const b = generateQuestionRules(richCtx, "final");
    expect(b).toEqual(a);
  });

  // With a fully-benchmarked context all 11 secondary categories are
  // available, so the stage budget (9/9/11/11) becomes the binding
  // constraint again: group/early_knockout cap at winner + 9 = 10, and
  // semis/final reach winner + 11 = 12 (the hard cap).
  it("respects the stage budget: group stage = 1 winner + 9 secondaries (10 total)", () => {
    const rules = generateQuestionRules(richCtx, "group");
    expect(rules).toHaveLength(10);
  });

  it("respects the stage budget: early knockout = 1 winner + 9 secondaries (10 total)", () => {
    const rules = generateQuestionRules(richCtx, "early_knockout");
    expect(rules).toHaveLength(10);
  });

  it("respects the stage budget: semis/final = 1 winner + 11 secondaries (12 total)", () => {
    expect(generateQuestionRules(richCtx, "semi_final")).toHaveLength(12);
    expect(generateQuestionRules(richCtx, "final")).toHaveLength(12);
  });

  it("never exceeds the hard cap of 12 cards", () => {
    for (const stage of ["group", "early_knockout", "semi_final", "final"] as const) {
      expect(generateQuestionRules(richCtx, stage).length).toBeLessThanOrEqual(
        HARD_CAP_TOTAL_CARDS,
      );
    }
  });

  it("prefers the last-10 corners aggregate as the first secondary when available", () => {
    const rules = generateQuestionRules(richCtx, "group");
    expect(rules[1]?.templateId).toBe("total_corners_last10");
  });

  it("falls back to the single-fixture corners benchmark when no last-10 aggregate exists", () => {
    const rules = generateQuestionRules(legacyBenchmarkCtx, "group");
    expect(rules[1]?.templateId).toBe("corners_inter_benchmark");
  });

  it("falls back further to the intra-fixture corners template when no benchmark at all exists", () => {
    const rules = generateQuestionRules(ctx, "group");
    expect(rules[1]?.templateId).toBe("corners_intra");
  });

  it("asserts the full secondary priority order under a rich context", () => {
    const rules = generateQuestionRules(richCtx, "final");
    expect(rules.map((r) => r.templateId)).toEqual([
      "winner",
      "total_corners_last10",
      "corners_intra",
      "total_yellow_cards_last10",
      "yellow_cards_intra",
      "red_card_occurrence",
      "goals_exact_margin",
      "period_corners_intra",
      "period_goals_intra",
      "total_goals_last10",
      "team_goals_last10_home",
      "team_goals_last10_away",
    ]);
  });

  it("only adds a yellow-card question once a clear benchmark exists", () => {
    const withoutBenchmark = generateQuestionRules(ctx, "early_knockout");
    expect(withoutBenchmark.some((r) => r.templateId === "yellow_cards_intra")).toBe(false);

    const withBenchmark = generateQuestionRules(richCtx, "early_knockout");
    expect(withBenchmark.some((r) => r.templateId === "yellow_cards_intra")).toBe(true);
  });

  it("reaches red cards via the always-available red_card_occurrence, superseding red_cards_intra", () => {
    const rules = generateQuestionRules(richCtx, "final");
    expect(rules.some((r) => r.templateId === "red_card_occurrence")).toBe(true);
    // red_card_occurrence is always available and ranks first in its
    // category, so red_cards_intra is never reached by generation (it stays
    // registered only so already-persisted rows still render/settle).
    expect(rules.some((r) => r.templateId === "red_cards_intra")).toBe(false);
  });

  it("never duplicates a template id within one fixture's questions", () => {
    const rules = generateQuestionRules(richCtx, "final");
    const ids = rules.map((r) => r.templateId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("without any benchmark, falls back entirely to always-available templates", () => {
    const rules = generateQuestionRules(ctx, "final");
    for (const rule of rules.slice(1)) {
      expect([
        "corners_intra",
        "red_card_occurrence",
        "goals_exact_margin",
        "period_corners_intra",
        "period_goals_intra",
      ]).toContain(rule.templateId);
    }
    // winner + the 5 always-available secondaries.
    expect(rules).toHaveLength(6);
  });
});

describe("SECONDARY_CATEGORIES", () => {
  const order = SECONDARY_CATEGORIES.map((c) => c.category);

  it("offers 11 secondary categories so a rich fixture can reach the 12-card hard cap", () => {
    expect(SECONDARY_CATEGORIES).toHaveLength(11);
  });

  it("ranks corners ahead of yellow cards, and yellow cards ahead of red cards", () => {
    expect(order.indexOf("corners_benchmark")).toBeLessThan(order.indexOf("yellow_cards_benchmark"));
    expect(order.indexOf("yellow_cards_benchmark")).toBeLessThan(order.indexOf("red_cards"));
  });

  it("prefers the last-10 aggregate over the single-fixture benchmark within a category", () => {
    const corners = SECONDARY_CATEGORIES.find((c) => c.category === "corners_benchmark");
    expect(corners?.templateIds[0]).toBe("total_corners_last10");
    expect(corners?.templateIds).toContain("corners_inter_benchmark");

    const teamGoals = SECONDARY_CATEGORIES.find((c) => c.category === "team_goals_home");
    expect(teamGoals?.templateIds[0]).toBe("team_goals_last10_home");
    expect(teamGoals?.templateIds).toContain("team_goals_inter_benchmark");
  });
});
