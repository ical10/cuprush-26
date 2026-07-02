import { describe, expect, it } from "vitest";
import { txLineMode } from "./client";

describe("txLineMode", () => {
  it("defaults to replay when TXLINE_MODE is unset", () => {
    expect(txLineMode({} as NodeJS.ProcessEnv)).toBe("replay");
  });

  it("selects live when TXLINE_MODE=live", () => {
    expect(txLineMode({ TXLINE_MODE: "live" } as NodeJS.ProcessEnv)).toBe("live");
  });

  it("falls back to replay for any other value", () => {
    expect(txLineMode({ TXLINE_MODE: "bogus" } as NodeJS.ProcessEnv)).toBe("replay");
  });
});
