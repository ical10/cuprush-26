import { describe, expect, it } from "vitest";
import { HARD_CAP_TOTAL_CARDS, secondaryBudget } from "./stage-budget";

describe("secondaryBudget", () => {
  it("gives group stage fixtures 1 secondary card", () => {
    expect(secondaryBudget("group")).toBe(1);
  });

  it("gives early knockout fixtures 2 secondary cards", () => {
    expect(secondaryBudget("early_knockout")).toBe(2);
  });

  it("gives semi-finals 3 secondary cards", () => {
    expect(secondaryBudget("semi_final")).toBe(3);
  });

  it("gives the final 3 secondary cards", () => {
    expect(secondaryBudget("final")).toBe(3);
  });

  it("never exceeds the hard cap once the winner card is included", () => {
    for (const stage of ["group", "early_knockout", "semi_final", "final"] as const) {
      expect(1 + secondaryBudget(stage)).toBeLessThanOrEqual(HARD_CAP_TOTAL_CARDS);
    }
  });
});

describe("HARD_CAP_TOTAL_CARDS", () => {
  it("is 4", () => {
    expect(HARD_CAP_TOTAL_CARDS).toBe(4);
  });
});
