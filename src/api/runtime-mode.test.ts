import { describe, expect, it } from "vitest";
import { parseAppRuntimeMode } from "./runtime-mode";

describe("parseAppRuntimeMode", () => {
  it("defaults to full mode", () => {
    expect(parseAppRuntimeMode(undefined)).toBe("full");
  });

  it.each(["full", "web"] as const)("accepts %s mode", (mode) => {
    expect(parseAppRuntimeMode(mode)).toBe(mode);
  });

  it("rejects unknown modes", () => {
    expect(() => parseAppRuntimeMode("worker")).toThrow();
  });
});
