import type { FixtureStage } from "../db/schema";

/** 1 winner + up to 3 secondary cards, whatever the stage. */
export const HARD_CAP_TOTAL_CARDS = 4;

const SECONDARY_BUDGET: Record<FixtureStage, number> = {
  group: 1,
  early_knockout: 2,
  semi_final: 3,
  final: 3,
};

/** Number of secondary (non-winner) cards a fixture's tournament stage allows. */
export function secondaryBudget(stage: FixtureStage): number {
  return SECONDARY_BUDGET[stage];
}
