import { describe, expect, it } from "vitest";
import { HARD_CAP_TOTAL_CARDS } from "./stage-budget";
import { SECONDARY_CATEGORIES, generateQuestionRules } from "./generate";
import type { GenerationContext } from "./types";

const ctx: GenerationContext = {
  fixtureId: "wc-2026-arg-fra",
  homeTeam: "Argentina",
  awayTeam: "France",
};

const richCtx: GenerationContext = {
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

  // Every stage's secondary budget (9/9/11/11) now exceeds the number of
  // registered secondary categories (6), so with a fully-benchmarked
  // context every stage surfaces all 6 available secondaries — the stage
  // budget itself stops being the binding constraint until more templates
  // are registered.
  it("respects the stage budget: group stage = 1 winner + all available secondaries", () => {
    const rules = generateQuestionRules(richCtx, "group");
    expect(rules).toHaveLength(7);
  });

  it("respects the stage budget: early knockout = 1 winner + all available secondaries", () => {
    const rules = generateQuestionRules(richCtx, "early_knockout");
    expect(rules).toHaveLength(7);
  });

  it("respects the stage budget: semis/final = 1 winner + all available secondaries", () => {
    expect(generateQuestionRules(richCtx, "semi_final")).toHaveLength(7);
    expect(generateQuestionRules(richCtx, "final")).toHaveLength(7);
  });

  it("never exceeds the hard cap of 12 cards", () => {
    for (const stage of ["group", "early_knockout", "semi_final", "final"] as const) {
      expect(generateQuestionRules(richCtx, stage).length).toBeLessThanOrEqual(
        HARD_CAP_TOTAL_CARDS,
      );
    }
  });

  it("prefers the inter-fixture corners benchmark over the intra fallback when a benchmark exists", () => {
    const rules = generateQuestionRules(richCtx, "group");
    expect(rules[1]?.templateId).toBe("corners_inter_benchmark");
  });

  it("falls back to the intra-fixture corners template when no benchmark fixture exists", () => {
    const rules = generateQuestionRules(ctx, "group");
    expect(rules[1]?.templateId).toBe("corners_intra");
  });

  it("only adds a yellow-card question once a clear benchmark exists", () => {
    const withoutBenchmark = generateQuestionRules(ctx, "early_knockout");
    expect(withoutBenchmark.some((r) => r.templateId === "yellow_cards_intra")).toBe(false);

    const withBenchmark = generateQuestionRules(richCtx, "early_knockout");
    expect(withBenchmark.some((r) => r.templateId === "yellow_cards_intra")).toBe(true);
  });

  it("only reaches red cards, sparingly, when both benchmark kinds are rich enough and budget allows", () => {
    const rules = generateQuestionRules(richCtx, "final");
    expect(rules.some((r) => r.templateId === "red_cards_intra")).toBe(true);

    const singleBenchmarkCtx: GenerationContext = { ...ctx, benchmarkFixture: richCtx.benchmarkFixture };
    const noRedRules = generateQuestionRules(singleBenchmarkCtx, "final");
    expect(noRedRules.some((r) => r.templateId === "red_cards_intra")).toBe(false);
  });

  it("never duplicates a template id within one fixture's questions", () => {
    const rules = generateQuestionRules(richCtx, "final");
    const ids = rules.map((r) => r.templateId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("without any benchmark, falls back entirely to always-available intra templates", () => {
    const rules = generateQuestionRules(ctx, "final");
    for (const rule of rules.slice(1)) {
      expect(["corners_intra", "goals_exact_margin", "period_corners_intra"]).toContain(
        rule.templateId,
      );
    }
  });
});

describe("SECONDARY_CATEGORIES", () => {
  it("ranks corners and goals ahead of yellow and red cards", () => {
    const order = SECONDARY_CATEGORIES.map((c) => c.category);
    expect(order.indexOf("corners")).toBeLessThan(order.indexOf("yellow_cards"));
    expect(order.indexOf("corners")).toBeLessThan(order.indexOf("red_cards"));
  });

  it("ranks yellow cards ahead of red cards", () => {
    const order = SECONDARY_CATEGORIES.map((c) => c.category);
    expect(order.indexOf("yellow_cards")).toBeLessThan(order.indexOf("red_cards"));
  });
});
