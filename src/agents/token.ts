import { createHash, randomBytes } from "node:crypto";

/**
 * Cohort bearer-token helpers. The plaintext token is generated once at
 * provisioning time, printed once, and never persisted — only its sha256 hash
 * is stored (agent_cohorts.token_hash).
 */

// sha256 hex digest of a cohort token. Deterministic, so a presented token can
// be re-hashed and compared against the stored hash.
export function hashCohortToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// A fresh 32-byte token, base64url-encoded, plus its stored hash.
export function generateCohortToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashCohortToken(token) };
}
