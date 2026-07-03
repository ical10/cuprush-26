/**
 * Deterministic seeding for question generation.
 *
 * The same (fixture id, template id) pair must always produce the same team
 * order and template pick — regenerating a fixture's questions, or retrying
 * an LLM call, must never change the on-chain rule. No external RNG
 * dependency: FNV-1a is a small, well-known, allocation-free string hash.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Stable 32-bit unsigned seed derived from the given string parts, joined by "|". */
export function deterministicSeed(...parts: string[]): number {
  const input = parts.join("|");
  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/** Deterministic boolean derived from a seed (e.g. to decide team order). */
export function seededBool(seed: number): boolean {
  return (seed & 1) === 1;
}

/** Deterministic integer in the inclusive [min, max] range. */
export function seededInt(seed: number, min: number, max: number): number {
  if (max < min) throw new Error(`seededInt: max (${max}) must be >= min (${min})`);
  const range = max - min + 1;
  return min + (seed % range);
}
