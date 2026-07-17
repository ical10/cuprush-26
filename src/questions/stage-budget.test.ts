import { describe, expect, it } from "vitest";
import { HARD_CAP_TOTAL_CARDS, secondaryBudget } from "./stage-budget";

describe("secondaryBudget", () => {
  it("gives group stage fixtures 9 secondary cards", () => {
    expect(secondaryBudget("group")).toBe(9);
  });

  it("gives early knockout fixtures 9 secondary cards", () => {
    expect(secondaryBudget("early_knockout")).toBe(9);
  });

  it("gives semi-finals 11 secondary cards", () => {
    expect(secondaryBudget("semi_final")).toBe(11);
  });

  it("gives the final 11 secondary cards", () => {
    expect(secondaryBudget("final")).toBe(11);
  });

  it("never exceeds the hard cap once the winner card is included", () => {
    for (const stage of ["group", "early_knockout", "semi_final", "final"] as const) {
      expect(1 + secondaryBudget(stage)).toBeLessThanOrEqual(HARD_CAP_TOTAL_CARDS);
    }
  });
});

describe("HARD_CAP_TOTAL_CARDS", () => {
  it("is 12", () => {
    expect(HARD_CAP_TOTAL_CARDS).toBe(12);
  });
});
