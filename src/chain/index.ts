import type { ChainAdapter } from "./adapter";
import { createSolanaChainAdapter, type SolanaChainEnv } from "./solana";
import { createStubChainAdapter } from "./stub";

export * from "./adapter";
export * from "./guardrails";
export { createStubChainAdapter } from "./stub";
export { createSolanaChainAdapter } from "./solana";

export type ChainEnv = SolanaChainEnv & { CHAIN_MODE?: string };

/**
 * CHAIN_MODE=solana selects the (HITL skeleton) mainnet adapter; anything
 * else gets the in-memory stub, which is the default for local dev and
 * every test.
 */
export function createChainAdapterFromEnv(
  env: ChainEnv = process.env,
): ChainAdapter {
  if (env.CHAIN_MODE === "solana") {
    return createSolanaChainAdapter(env);
  }
  return createStubChainAdapter();
}
