/**
 * Chain adapter interface mirroring program/programs/world-cup-hilo (three
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

export type ChainPrediction = {
  pda: string;
  questionPda: string;
  wallet: string;
  outcome: ChainOutcome;
  signature: string;
  submittedAt: Date;
};

export type ChainErrorCode =
  | "invalid_window"
  | "question_exists"
  | "question_not_found"
  | "question_not_open"
  | "prediction_exists"
  | "before_open"
  | "after_lock"
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
  /** Deterministic Prediction address for seeds [b"prediction", question, wallet]. */
  derivePredictionPda(questionPda: string, wallet: string): string;
  createQuestion(rule: ChainQuestionRule): Promise<{ pda: string }>;
  submitPrediction(input: {
    questionPda: string;
    wallet: string;
    outcome: ChainOutcome;
  }): Promise<{ pda: string; signature: string }>;
  settleQuestion(input: {
    questionPda: string;
    result: ChainQuestionResult;
  }): Promise<{ signature: string }>;
  getQuestion(pda: string): Promise<ChainQuestion | null>;
  getPrediction(pda: string): Promise<ChainPrediction | null>;
}
