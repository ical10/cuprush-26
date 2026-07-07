import { describe, expect, it } from "vitest";
import { buildShareText } from "./share-text";

describe("buildShareText", () => {
  it("leads with the win phrase and carries the brand share line", () => {
    const text = buildShareText({ won: true, streak: 4, question: "Over 2 goals?" });
    expect(text).toBe(
      'Called it: "Over 2 goals?" — streak: 4. I made the call. Can you beat it? Play CupRush 26.',
    );
  });

  it("stays calm on a miss — no shaming copy", () => {
    const text = buildShareText({ won: false, streak: 0, question: "Over 2 goals?" });
    expect(text).toContain("Not this time");
    expect(text).not.toMatch(/missed|lost|fail/i);
  });

  it("handles a pending result", () => {
    const text = buildShareText({ won: null, streak: 2, question: "Over 2 goals?" });
    expect(text).toContain("Result pending");
  });

  it("names CupRush 26, never the old working title", () => {
    const text = buildShareText({ won: true, streak: 1, question: "Q" });
    expect(text).toContain("CupRush 26");
    expect(text).not.toContain("World Cup Hi-Lo");
  });
});
