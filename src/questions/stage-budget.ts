import type { FixtureStage } from "../db/schema";

/** 1 winner + up to 11 secondary cards, whatever the stage. */
export const HARD_CAP_TOTAL_CARDS = 12;

const SECONDARY_BUDGET: Record<FixtureStage, number> = {
  group: 9,
  early_knockout: 9,
  semi_final: 11,
  final: 11,
};

/** Number of secondary (non-winner) cards a fixture's tournament stage allows. */
export function secondaryBudget(stage: FixtureStage): number {
  return SECONDARY_BUDGET[stage];
}
