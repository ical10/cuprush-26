/**
 * Chain adapter interface mirroring program/programs/cuprush (three
 * instructions over two accounts). Implementations: the in-memory stub
 * (src/chain/stub.ts — default for dev and tests) and the solana skeleton
 * (src/chain/solana.ts — HITL until the program is deployed, issue 13).
 */

export type ChainOutcome = "yes" | "no" | "higher" | "lower";

export type ChainQuestionResult = ChainOutcome | "push";

/** The immutable on-chain rule fields (CreateQuestionArgs in lib.rs). */
export type ChainQuestionRule = {
  /** sha256 hex of the canonical rule — see src/questions/rule-hash.ts. */
  ruleHash: string;
  fixtureId: string;
  benchmarkFixtureId: string | null;
  statKey1: string;
  statKey2: string;
  operator: "add" | "subtract";
  comparison: "equal" | "greater_than" | "less_than";
  threshold: number | null;
  benchmarkValue: number | null;
  opensAt: Date;
  locksAt: Date;
};

export type ChainQuestion = ChainQuestionRule & {
  pda: string;
  status: "open" | "settled";
  result: ChainQuestionResult | null;
};

/**
 * One batch commitment per player wallet: a single hash over all their
 * predictions (see src/predictions/hash.ts), stored on chain instead of one
 * account per answer. Seeds [b"batch", wallet].
 */
export type ChainBatch = {
  pda: string;
  wallet: string;
  batchHash: string;
  signature: string;
  submittedAt: Date;
};

export type ChainErrorCode =
  | "invalid_window"
  | "question_exists"
  | "question_not_found"
  | "batch_exists"
  | "already_settled"
  | "not_configured";

export class ChainError extends Error {
  constructor(
    readonly code: ChainErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ChainError";
  }
}

export function isChainError(
  error: unknown,
  code?: ChainErrorCode,
): error is ChainError {
  return error instanceof ChainError && (code === undefined || error.code === code);
}

export interface ChainAdapter {
  /** Deterministic Question address for seeds [b"question", rule_hash]. */
  deriveQuestionPda(ruleHash: string): string;
  /** Deterministic Batch address for seeds [b"batch", wallet]. */
  deriveBatchPda(wallet: string): string;
  createQuestion(rule: ChainQuestionRule): Promise<{ pda: string }>;
  /** Commit one player's whole prediction batch by its hash. */
  submitBatch(input: {
    wallet: string;
    batchHash: string;
  }): Promise<{ pda: string; signature: string }>;
  settleQuestion(input: {
    questionPda: string;
    result: ChainQuestionResult;
  }): Promise<{ signature: string }>;
  getQuestion(pda: string): Promise<ChainQuestion | null>;
  getBatch(pda: string): Promise<ChainBatch | null>;
}
