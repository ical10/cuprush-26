import { describe, expect, it } from "vitest";
import { isFixtureAllowed, parseTeamAllowlist } from "./allowlist";

describe("parseTeamAllowlist", () => {
  it("treats undefined as allow-all (null)", () => {
    expect(parseTeamAllowlist(undefined)).toBeNull();
  });

  it("treats an empty string as allow-all (null)", () => {
    expect(parseTeamAllowlist("")).toBeNull();
  });

  it("treats a whitespace/comma-only string as allow-all (null)", () => {
    expect(parseTeamAllowlist("  ,  , ")).toBeNull();
  });

  it("parses names, lower-casing and trimming each", () => {
    const allowlist = parseTeamAllowlist("  Spain , ARGENTINA,england ");
    expect(allowlist).not.toBeNull();
    expect(allowlist).toEqual(new Set(["spain", "argentina", "england"]));
  });

  it("drops empty entries between commas", () => {
    expect(parseTeamAllowlist("Spain,,France,")).toEqual(new Set(["spain", "france"]));
  });
});

describe("isFixtureAllowed", () => {
  it("allows every fixture when the allowlist is null", () => {
    expect(isFixtureAllowed(null, "Myanmar", "Vietnam")).toBe(true);
  });

  it("allows a fixture only when BOTH teams are listed", () => {
    const allowlist = parseTeamAllowlist("Spain,Argentina");
    expect(isFixtureAllowed(allowlist, "Spain", "Argentina")).toBe(true);
    expect(isFixtureAllowed(allowlist, "Spain", "Myanmar")).toBe(false);
    expect(isFixtureAllowed(allowlist, "Myanmar", "Vietnam")).toBe(false);
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    const allowlist = parseTeamAllowlist("Spain,Argentina");
    expect(isFixtureAllowed(allowlist, "  spain  ", "ARGENTINA")).toBe(true);
  });
});
