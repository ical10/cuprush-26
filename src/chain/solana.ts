import { ChainError, type ChainAdapter } from "./adapter";

/**
 * Solana (mainnet) chain adapter — intentionally a thin HITL skeleton.
 *
 * The real implementation needs the deployed program id (issue 13), an RPC
 * endpoint, the Privy sponsorship/fee-payer wiring, and @solana/web3.js for
 * PDA derivation and transaction building. None of that is decidable
 * without credentials, so this module only validates configuration and
 * fails loudly; the stub adapter (src/chain/stub.ts) carries dev and tests.
 */

export type SolanaChainEnv = {
  SOLANA_RPC_URL?: string;
  HILO_PROGRAM_ID?: string;
};

export function createSolanaChainAdapter(
  env: SolanaChainEnv = process.env,
): ChainAdapter {
  if (!env.SOLANA_RPC_URL || !env.HILO_PROGRAM_ID) {
    throw new ChainError(
      "not_configured",
      "solana chain adapter is not configured: CHAIN_MODE=solana requires " +
        "SOLANA_RPC_URL and HILO_PROGRAM_ID (mainnet deploy is HITL, issue 13)",
    );
  }

  const notImplemented = (): never => {
    throw new ChainError(
      "not_configured",
      "solana chain adapter is a HITL skeleton (issue 13): deploy the " +
        "program, then implement PDA derivation and sponsored transaction " +
        "submission via @solana/web3.js",
    );
  };

  return {
    deriveQuestionPda: notImplemented,
    deriveBatchPda: notImplemented,
    createQuestion: () => Promise.reject(makeNotImplementedError()),
    submitBatch: () => Promise.reject(makeNotImplementedError()),
    settleQuestion: () => Promise.reject(makeNotImplementedError()),
    getQuestion: () => Promise.reject(makeNotImplementedError()),
    getBatch: () => Promise.reject(makeNotImplementedError()),
  };
}

function makeNotImplementedError(): ChainError {
  return new ChainError(
    "not_configured",
    "solana chain adapter is a HITL skeleton (issue 13)",
  );
}
