import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./guardrails";

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
