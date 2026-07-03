import { describe, expect, it } from "vitest";
import {
  HILO_INSTRUCTIONS,
  createRateLimiter,
  isAllowlistedInstruction,
  type InstructionAllowlist,
} from "./guardrails";

const allowlist: InstructionAllowlist = {
  programId: "2Yon9VrntK9ASpvHRJ1NzeTFBziWtUWPYVBZZWdk68to",
  instructions: HILO_INSTRUCTIONS,
};

describe("isAllowlistedInstruction", () => {
  it("accepts the Hi-Lo program with a supported instruction", () => {
    expect(
      isAllowlistedInstruction(allowlist, allowlist.programId, "submit_prediction"),
    ).toBe(true);
  });

  it("rejects any other program id", () => {
    expect(
      isAllowlistedInstruction(allowlist, "11111111111111111111111111111111", "submit_prediction"),
    ).toBe(false);
  });

  it("rejects an instruction outside the allowlist (e.g. a transfer)", () => {
    expect(isAllowlistedInstruction(allowlist, allowlist.programId, "transfer")).toBe(false);
  });

  it("covers exactly the three game instructions", () => {
    expect(HILO_INSTRUCTIONS).toEqual([
      "create_question",
      "submit_prediction",
      "settle_question",
    ]);
  });
});

describe("createRateLimiter", () => {
  it("allows up to the limit per window and rejects the next call", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, clock: () => now });

    expect(limiter.allow("wallet-1")).toBe(true);
    expect(limiter.allow("wallet-1")).toBe(true);
    expect(limiter.allow("wallet-1")).toBe(true);
    expect(limiter.allow("wallet-1")).toBe(false);
    now = 1;
    expect(limiter.allow("wallet-1")).toBe(false);
  });

  it("tracks keys independently", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, clock: () => 0 });
    expect(limiter.allow("wallet-1")).toBe(true);
    expect(limiter.allow("wallet-2")).toBe(true);
    expect(limiter.allow("wallet-1")).toBe(false);
  });

  it("frees capacity once the window slides past old submissions", () => {
    let now = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, clock: () => now });

    expect(limiter.allow("k")).toBe(true);
    now = 30_000;
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(false);

    now = 60_000; // the first call has aged out of the window
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(false);
  });
});
