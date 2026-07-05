import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeBatchHash } from "./hash";

describe("computeBatchHash", () => {
  it("is independent of input order", () => {
    const a = computeBatchHash([
      { questionId: "q2", outcome: "no" },
      { questionId: "q1", outcome: "yes" },
    ]);
    const b = computeBatchHash([
      { questionId: "q1", outcome: "yes" },
      { questionId: "q2", outcome: "no" },
    ]);
    expect(a).toBe(b);
  });

  it("differs when an outcome differs", () => {
    const a = computeBatchHash([{ questionId: "q1", outcome: "yes" }]);
    const b = computeBatchHash([{ questionId: "q1", outcome: "no" }]);
    expect(a).not.toBe(b);
  });

  it("differs when the question set differs", () => {
    const a = computeBatchHash([{ questionId: "q1", outcome: "yes" }]);
    const b = computeBatchHash([
      { questionId: "q1", outcome: "yes" },
      { questionId: "q2", outcome: "yes" },
    ]);
    expect(a).not.toBe(b);
  });

  it("returns a 64-char sha256 hex digest", () => {
    const hash = computeBatchHash([{ questionId: "q1", outcome: "yes" }]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes the empty batch to the sha256 of the empty string", () => {
    expect(computeBatchHash([])).toBe(
      createHash("sha256").update("").digest("hex"),
    );
  });
});
