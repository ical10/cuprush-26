import { describe, expect, it } from "vitest";
import { generateCohortToken, hashCohortToken } from "./token";

describe("cohort token", () => {
  it("generates a base64url token that decodes to 32 bytes", () => {
    const { token } = generateCohortToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("stores a sha256 hex hash that round-trips from the plaintext", () => {
    const { token, hash } = generateCohortToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCohortToken(token)).toBe(hash);
  });

  it("produces a distinct token on each call", () => {
    const a = generateCohortToken();
    const b = generateCohortToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });

  it("hashes deterministically", () => {
    expect(hashCohortToken("fixed-input")).toBe(hashCohortToken("fixed-input"));
  });
});
