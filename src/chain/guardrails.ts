/**
 * Sponsorship guardrails (pure, in-memory). The sponsor path must only ever
 * pay for allowlisted Hi-Lo instructions, and no wallet may spam
 * submissions — see the research doc "Sponsorship guardrails". The API
 * layer applies these before any chain submission.
 */

export const HILO_INSTRUCTIONS = [
  "create_question",
  "submit_prediction",
  "settle_question",
] as const;

export type HiLoInstruction = (typeof HILO_INSTRUCTIONS)[number];

export type InstructionAllowlist = {
  programId: string;
  instructions: readonly string[];
};

/** True only for the exact allowlisted program id + instruction name. */
export function isAllowlistedInstruction(
  allowlist: InstructionAllowlist,
  programId: string,
  instruction: string,
): boolean {
  return (
    programId === allowlist.programId &&
    allowlist.instructions.includes(instruction)
  );
}

export type RateLimiter = {
  /** Records one attempt for `key`; false when the cap is already reached. */
  allow(key: string): boolean;
};

export type RateLimiterOptions = {
  limit: number;
  windowMs: number;
  clock?: () => number;
};

/** Sliding-window submission cap per key (wallet, participant, IP, ...). */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const clock = options.clock ?? Date.now;
  const attempts = new Map<string, number[]>();

  return {
    allow(key: string): boolean {
      const now = clock();
      const cutoff = now - options.windowMs;
      const recent = (attempts.get(key) ?? []).filter((at) => at > cutoff);
      if (recent.length >= options.limit) {
        attempts.set(key, recent);
        return false;
      }
      recent.push(now);
      attempts.set(key, recent);
      return true;
    },
  };
}
