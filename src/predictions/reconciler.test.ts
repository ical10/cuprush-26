import { describe, expect, it } from "vitest";
import {
  BASE_RETRY_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  retryDelayMs,
} from "./reconciler";

describe("retryDelayMs", () => {
  it("starts at the base delay", () => {
    expect(retryDelayMs(1)).toBe(BASE_RETRY_DELAY_MS);
  });

  it("doubles per attempt", () => {
    expect(retryDelayMs(2)).toBe(BASE_RETRY_DELAY_MS * 2);
    expect(retryDelayMs(3)).toBe(BASE_RETRY_DELAY_MS * 4);
    expect(retryDelayMs(4)).toBe(BASE_RETRY_DELAY_MS * 8);
  });

  it("caps at the maximum delay", () => {
    expect(retryDelayMs(6)).toBe(MAX_RETRY_DELAY_MS);
    expect(retryDelayMs(50)).toBe(MAX_RETRY_DELAY_MS);
  });

  it("tolerates a zero attempt count", () => {
    expect(retryDelayMs(0)).toBe(BASE_RETRY_DELAY_MS);
  });
});
