import { createHash } from "node:crypto";

export type BatchAnswer = {
  questionId: string;
  outcome: string;
};

/**
 * Canonical sha256 hex commitment over a participant's whole batch of
 * predictions. Sorts by questionId so the digest is independent of swipe
 * order, then joins "questionId:outcome" pairs. The server recomputes this
 * from the rows it actually inserted — a client-supplied hash is never
 * trusted. `outcome` is the user's predicted value (yes/no/higher/lower),
 * not the settled result.
 */
export function computeBatchHash(answers: readonly BatchAnswer[]): string {
  const canonical = [...answers]
    .sort((a, b) => (a.questionId < b.questionId ? -1 : a.questionId > b.questionId ? 1 : 0))
    .map((answer) => `${answer.questionId}:${answer.outcome}`)
    .join("|");

  return createHash("sha256").update(canonical).digest("hex");
}
