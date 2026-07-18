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
  /** Base58 key that created the question (Question.authority on chain). */
  authority: string;
  status: "open" | "settled" | "void";
  result: ChainQuestionResult | null;
};

/**
 * One batch commitment per (player wallet, fixture): a single hash over that
 * player's predictions for one fixture (see src/predictions/hash.ts), stored
 * on chain instead of one account per answer. Seeds [b"batch", wallet,
 * fixture_id].
 *
 * `fixtureId` is null only for legacy v1 commitments (memo `...:batch:v1:...`,
 * which predate per-fixture batches and carry no fixture segment). Everything
 * written under the v2 memo carries its fixtureId.
 */
export type ChainBatch = {
  pda: string;
  wallet: string;
  fixtureId: string | null;
  batchHash: string;
  signature: string;
  submittedAt: Date;
};

/**
 * A fixtureId is embedded verbatim in the batch memo between colon delimiters
 * (`...:v2:<wallet>:<fixtureId>:<hash>`), so it must not itself contain ':'
 * or the segments become ambiguous. Enforced wherever a batch memo/PDA is
 * built. TxLINE fixture ids are colon-free, so this only ever rejects
 * malformed input.
 */
export function assertBatchFixtureId(fixtureId: string): void {
  if (fixtureId.includes(":")) {
    throw new Error(
      `fixtureId must not contain ':' (batch memo delimiter): ${fixtureId}`,
    );
  }
}

export type ChainErrorCode =
  | "invalid_window"
  | "question_exists"
  | "question_not_found"
  | "batch_exists"
  | "already_settled"
  | "authority_mismatch"
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
  /**
   * Base58 of the trusted authority this adapter signs with. Callers compare
   * it against a question's on-chain `authority` to reject PDA squatting.
   */
  readonly authorityPubkey: string;
  /** Deterministic Question address for seeds [b"question", rule_hash]. */
  deriveQuestionPda(ruleHash: string): string;
  /** Deterministic Batch address for seeds [b"batch", wallet, fixture_id]. */
  deriveBatchPda(wallet: string, fixtureId: string): string;
  createQuestion(rule: ChainQuestionRule): Promise<{ pda: string }>;
  /** Commit one player's prediction batch for a fixture by its hash. */
  submitBatch(input: {
    wallet: string;
    fixtureId: string;
    batchHash: string;
  }): Promise<{ pda: string; signature: string }>;
  settleQuestion(input: {
    questionPda: string;
    result: ChainQuestionResult;
  }): Promise<{ signature: string }>;
  getQuestion(pda: string): Promise<ChainQuestion | null>;
  /**
   * The v2 commitment for this exact (wallet, fixture) pair, oldest-valid
   * wins. Never returns a legacy v1 commitment — those carry no fixtureId and
   * can't be safely attributed to a fixture here; use `getLegacyBatch`.
   */
  getBatch(wallet: string, fixtureId: string): Promise<ChainBatch | null>;
  /**
   * The legacy v1 commitment for this wallet (memo `...:batch:v1:...`, no
   * fixture segment), oldest-valid wins, or null. Callers bridge it to a
   * specific fixture only after confirming the hash matches that fixture's
   * batch — the hash is the content proof. Returns a ChainBatch with
   * `fixtureId: null`.
   */
  getLegacyBatch(wallet: string): Promise<ChainBatch | null>;
}
