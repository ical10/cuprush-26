import { createHash } from "node:crypto";

/**
 * The immutable fields that define one question's on-chain rule. Two
 * questions with identical canonical rules are the same question — the
 * database's unique `rule_hash` constraint on `questions` relies on this to
 * make regeneration idempotent (see src/questions/generate.ts).
 */
export type CanonicalRule = {
  fixtureId: string;
  benchmarkFixtureId?: string | null;
  statKey1: string;
  statKey2: string;
  operator: "add" | "subtract";
  comparison: "equal" | "greater_than" | "less_than";
  threshold: number | null;
};

/** Stable sha256 hex digest over the canonical rule fields, in fixed order. */
export function computeRuleHash(rule: CanonicalRule): string {
  const canonical = [
    rule.fixtureId,
    rule.benchmarkFixtureId ?? "",
    rule.statKey1,
    rule.statKey2,
    rule.operator,
    rule.comparison,
    rule.threshold ?? "",
  ].join("::");

  return createHash("sha256").update(canonical).digest("hex");
}
