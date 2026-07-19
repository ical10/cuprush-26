import { afterEach, describe, expect, it, vi } from "vitest";
import { isFixtureInCompetition, parseCompetitionId } from "./competition";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseCompetitionId", () => {
  it("treats undefined as allow-all (null)", () => {
    expect(parseCompetitionId(undefined)).toBeNull();
  });

  it("treats an empty or whitespace-only string as allow-all (null)", () => {
    expect(parseCompetitionId("")).toBeNull();
    expect(parseCompetitionId("   ")).toBeNull();
  });

  it("parses an integer, ignoring surrounding whitespace", () => {
    expect(parseCompetitionId("  72 ")).toBe(72);
  });

  it("warns and falls back to allow-all for a non-integer value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseCompetitionId("world-cup")).toBeNull();
    expect(parseCompetitionId("72.5")).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("isFixtureInCompetition", () => {
  it("allows every fixture when the filter is null", () => {
    expect(isFixtureInCompetition(null, 430)).toBe(true);
    expect(isFixtureInCompetition(null, null)).toBe(true);
  });

  it("allows only a fixture whose competitionId matches the filter", () => {
    expect(isFixtureInCompetition(72, 72)).toBe(true);
    expect(isFixtureInCompetition(72, 430)).toBe(false);
  });

  it("rejects a fixture with an unknown (null) competition when a filter is set", () => {
    expect(isFixtureInCompetition(72, null)).toBe(false);
  });
});
