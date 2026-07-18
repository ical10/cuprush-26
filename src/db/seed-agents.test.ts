import { describe, expect, it } from "vitest";
import { AGENT_SEEDS, SEED_MODEL } from "./seed-agents";

describe("AGENT_SEEDS", () => {
  it("defines exactly ten agents", () => {
    expect(AGENT_SEEDS).toHaveLength(10);
  });

  it("has unique agent keys", () => {
    const keys = AGENT_SEEDS.map((seed) => seed.agentKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has unique display names", () => {
    const names = AGENT_SEEDS.map((seed) => seed.displayName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("respects the schema column length limits", () => {
    for (const seed of AGENT_SEEDS) {
      expect(seed.agentKey.length).toBeLessThanOrEqual(32);
      expect(seed.displayName.length).toBeLessThanOrEqual(32);
    }
    expect(SEED_MODEL.length).toBeLessThanOrEqual(64);
  });

  it("gives every agent a one-sentence persona and strategy", () => {
    for (const seed of AGENT_SEEDS) {
      expect(seed.persona.trim().length).toBeGreaterThan(0);
      expect(seed.strategy.trim().length).toBeGreaterThan(0);
      expect(seed.persona.trim().endsWith(".")).toBe(true);
      expect(seed.strategy.trim().endsWith(".")).toBe(true);
    }
  });

  it("pins the placeholder model", () => {
    expect(SEED_MODEL).toBe("hermes-pinned");
  });
});
