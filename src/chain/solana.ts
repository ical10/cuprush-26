import { Buffer } from "node:buffer";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
// @coral-xyz/anchor ships as CJS. Node's native ESM loader statically
// analyzes CJS named exports via cjs-module-lexer and fails to detect BN
// here (passes under vitest/tsx's more permissive esbuild interop, which
// is why this only breaks in production) — import the default and
// destructure at runtime instead.
import anchorPkg from "@coral-xyz/anchor";
import type { BN as BNValue, Idl } from "@coral-xyz/anchor";
const { BN, BorshCoder, utils } = anchorPkg;
type BN = BNValue;
import {
  ChainError,
  isChainError,
  type ChainAdapter,
  type ChainBatch,
  type ChainQuestion,
  type ChainQuestionResult,
  type ChainQuestionRule,
} from "./adapter";
import idlJson from "./idl/world_cup_hilo.json";

/**
 * Devnet Solana chain adapter — the production chain path for CupRush 26
 * (devnet-only product decision).
 *
 * Questions map 1:1 onto the deployed world_cup_hilo Anchor program:
 * `create_question` / `settle_question` instructions and the Question
 * account at seeds [b"question", rule_hash].
 *
 * Batches have no program instruction (the program predates the batched
 * prediction model and its Rust is frozen), so the batch commitment is
 * bridged: `submitBatch` lands one transaction that (a) references the
 * deterministic batch PDA at seeds [b"batch", wallet] so the commitment is
 * discoverable by address, and (b) records `wallet:batchHash` in an SPL
 * Memo instruction. `getBatch` reads it back via getSignaturesForAddress
 * and only trusts transactions fee-paid by this adapter's authority, so a
 * third party cannot spoof a commitment. First valid transaction wins —
 * later writes never change what `getBatch` returns, mirroring the
 * program's init-once semantics.
 *
 * Construction is offline: env is validated fail-closed, but the RPC
 * connection is only opened on first use.
 */

export type SolanaChainEnv = {
  SOLANA_RPC_URL?: string;
  CUPRUSH_PROGRAM_ID?: string;
  SOLANA_PRIVATE_KEY?: string;
};

export const DEFAULT_SOLANA_RPC_URL = "https://api.devnet.solana.com";

export const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

/** Version-tagged memo prefix identifying a CupRush batch commitment. */
export const BATCH_MEMO_PREFIX = "cuprush26:batch:v1";

const QUESTION_SEED = Buffer.from("question");
const BATCH_SEED = Buffer.from("batch");

const SIGNATURE_PAGE_LIMIT = 1000;

/**
 * The narrow slice of @solana/web3.js `Connection` the adapter uses. Unit
 * tests inject a fake; production wraps a real Connection (lazily).
 */
export type SolanaRpc = {
  getAccountInfo(address: PublicKey): Promise<{ data: Buffer } | null>;
  getLatestBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }>;
  sendRawTransaction(rawTransaction: Uint8Array): Promise<string>;
  confirmTransaction(strategy: {
    signature: string;
    blockhash: string;
    lastValidBlockHeight: number;
  }): Promise<{ value: { err: unknown } }>;
  getSignaturesForAddress(
    address: PublicKey,
    options?: { before?: string; limit?: number },
  ): Promise<{ signature: string; blockTime?: number | null; err?: unknown }[]>;
  getTransaction(signature: string): Promise<FetchedTransaction | null>;
};

export type FetchedTransaction = {
  blockTime?: number | null;
  meta: { err: unknown } | null;
  transaction: {
    message: {
      staticAccountKeys: PublicKey[];
      compiledInstructions: { programIdIndex: number; data: Uint8Array }[];
    };
  };
};

export type SolanaChainAdapterOptions = {
  /** Test seam: inject a fake RPC instead of a devnet Connection. */
  connection?: SolanaRpc;
  clock?: () => Date;
};

function wrapConnection(connection: Connection): SolanaRpc {
  return {
    getAccountInfo: (address) => connection.getAccountInfo(address),
    getLatestBlockhash: () => connection.getLatestBlockhash(),
    sendRawTransaction: (raw) => connection.sendRawTransaction(raw),
    confirmTransaction: (strategy) =>
      connection.confirmTransaction(strategy, "confirmed"),
    getSignaturesForAddress: (address, options) =>
      connection.getSignaturesForAddress(address, options, "confirmed"),
    getTransaction: async (signature) => {
      const response = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      if (!response) return null;
      const message = response.transaction.message;
      return {
        blockTime: response.blockTime,
        meta: response.meta,
        transaction: {
          message: {
            staticAccountKeys: message.staticAccountKeys,
            compiledInstructions: message.compiledInstructions,
          },
        },
      };
    },
  };
}

/** Accepts a JSON byte-array keyfile string or a base58-encoded secret. */
function parseSecretKey(raw: string): Keypair {
  const bytes = raw.trim().startsWith("[")
    ? Uint8Array.from(JSON.parse(raw) as number[])
    : utils.bytes.bs58.decode(raw.trim());
  return Keypair.fromSecretKey(bytes);
}

const OPERATOR_VARIANTS = { add: "Add", subtract: "Subtract" } as const;
const COMPARISON_VARIANTS = {
  equal: "Equal",
  greater_than: "GreaterThan",
  less_than: "LessThan",
} as const;
const RESULT_VARIANTS = {
  yes: "Yes",
  no: "No",
  higher: "Higher",
  lower: "Lower",
  push: "Push",
} as const;

type EnumValue = Record<string, object>;

function variant(name: string): EnumValue {
  return { [name]: {} };
}

function variantName(value: EnumValue): string {
  const name = Object.keys(value)[0];
  if (!name) throw new Error("empty enum variant in decoded account");
  return name;
}

/** Snake-case borsh view of the Question account (coder keeps IDL names). */
type RawQuestion = {
  authority: PublicKey;
  rule_hash: number[];
  fixture_id: string;
  benchmark_fixture_id: string | null;
  stat_key_1: string;
  stat_key_2: string;
  operator: EnumValue;
  comparison: EnumValue;
  threshold: BN | null;
  benchmark: BN | null;
  opens_at: BN;
  locks_at: BN;
  status: EnumValue;
  result: EnumValue | null;
  bump: number;
};

/** Anchor custom error codes the app's taxonomy has names for (lib.rs). */
const PROGRAM_ERROR_CODES: Record<number, ChainError["code"]> = {
  6000: "invalid_window",
  6006: "already_settled",
};

function extractCustomErrorCode(text: string): number | undefined {
  const hex = /custom program error: (0x[0-9a-f]+)/i.exec(text);
  if (hex?.[1]) return Number.parseInt(hex[1], 16);
  const json = /"Custom":\s*(\d+)/.exec(text);
  if (json?.[1]) return Number.parseInt(json[1], 10);
  const anchorLog = /Error Number: (\d+)/.exec(text);
  if (anchorLog?.[1]) return Number.parseInt(anchorLog[1], 10);
  return undefined;
}

/**
 * Maps a send/confirm failure onto the stub's ChainError taxonomy. Anything
 * transient (blockhash expiry, insufficient fee-payer funds, RPC outages)
 * stays a plain Error so the reconciler retries it with backoff instead of
 * treating it as a terminal chain state.
 */
function toChainError(
  error: unknown,
  context: "create_question" | "settle_question" | "submit_batch",
  pda: string,
): unknown {
  if (isChainError(error)) return error;
  const logs = (error as { logs?: unknown }).logs;
  const text = [
    error instanceof Error ? error.message : String(error),
    ...(Array.isArray(logs) ? logs.map(String) : []),
  ].join("\n");

  if (context === "create_question" && text.includes("already in use")) {
    return new ChainError("question_exists", `question account in use: ${pda}`);
  }
  const code = extractCustomErrorCode(text);
  if (code !== undefined) {
    const mapped = PROGRAM_ERROR_CODES[code];
    if (mapped) return new ChainError(mapped, `${context} failed: ${text}`);
  }
  return error;
}

export function createSolanaChainAdapter(
  env: SolanaChainEnv = process.env,
  options: SolanaChainAdapterOptions = {},
): ChainAdapter {
  const missing = (["CUPRUSH_PROGRAM_ID", "SOLANA_PRIVATE_KEY"] as const).filter(
    (name) => !env[name],
  );
  if (missing.length > 0) {
    throw new ChainError(
      "not_configured",
      "solana chain adapter is not configured: CHAIN_MODE=solana requires " +
        `${missing.join(" and ")} (SOLANA_RPC_URL defaults to devnet)`,
    );
  }

  let programId: PublicKey;
  try {
    programId = new PublicKey(env.CUPRUSH_PROGRAM_ID as string);
  } catch {
    throw new ChainError(
      "not_configured",
      "solana chain adapter is not configured: CUPRUSH_PROGRAM_ID is not a valid public key",
    );
  }

  let authority: Keypair;
  try {
    authority = parseSecretKey(env.SOLANA_PRIVATE_KEY as string);
  } catch {
    // Never echo the value: it is the signing key.
    throw new ChainError(
      "not_configured",
      "solana chain adapter is not configured: SOLANA_PRIVATE_KEY must be a " +
        "JSON byte array or base58-encoded 64-byte secret key",
    );
  }

  const rpcUrl = env.SOLANA_RPC_URL || DEFAULT_SOLANA_RPC_URL;
  const clock = options.clock ?? (() => new Date());
  const coder = new BorshCoder(idlJson as Idl);

  let connection: SolanaRpc | undefined = options.connection;
  const rpc = (): SolanaRpc =>
    (connection ??= wrapConnection(new Connection(rpcUrl, "confirmed")));

  function deriveQuestionPda(ruleHash: string): string {
    if (!/^[0-9a-f]{64}$/i.test(ruleHash)) {
      throw new Error(`ruleHash must be 32 bytes of hex, got: ${ruleHash}`);
    }
    const [pda] = PublicKey.findProgramAddressSync(
      [QUESTION_SEED, Buffer.from(ruleHash, "hex")],
      programId,
    );
    return pda.toBase58();
  }

  function deriveBatchPda(wallet: string): string {
    const [pda] = PublicKey.findProgramAddressSync(
      [BATCH_SEED, new PublicKey(wallet).toBuffer()],
      programId,
    );
    return pda.toBase58();
  }

  async function sendAndConfirm(
    instructions: TransactionInstruction[],
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await rpc().getLatestBlockhash();
    const message = new TransactionMessage({
      payerKey: authority.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);
    transaction.sign([authority]);

    const signature = await rpc().sendRawTransaction(transaction.serialize());
    const confirmation = await rpc().confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    });
    if (confirmation.value.err) {
      throw new Error(
        `transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)}`,
      );
    }
    return signature;
  }

  function decodeQuestion(pda: string, data: Buffer): ChainQuestion {
    const raw = coder.accounts.decode<RawQuestion>("Question", data);
    return {
      pda,
      ruleHash: Buffer.from(raw.rule_hash).toString("hex"),
      fixtureId: raw.fixture_id,
      benchmarkFixtureId: raw.benchmark_fixture_id,
      statKey1: raw.stat_key_1,
      statKey2: raw.stat_key_2,
      operator: variantName(raw.operator).toLowerCase() as "add" | "subtract",
      comparison:
        variantName(raw.comparison) === "GreaterThan"
          ? "greater_than"
          : variantName(raw.comparison) === "LessThan"
            ? "less_than"
            : "equal",
      threshold: raw.threshold === null ? null : raw.threshold.toNumber(),
      benchmarkValue: raw.benchmark === null ? null : raw.benchmark.toNumber(),
      opensAt: new Date(raw.opens_at.toNumber() * 1000),
      locksAt: new Date(raw.locks_at.toNumber() * 1000),
      status: variantName(raw.status) === "Open" ? "open" : "settled",
      result:
        raw.result === null
          ? null
          : (variantName(raw.result).toLowerCase() as ChainQuestionResult),
    };
  }

  /** All signatures mentioning `address`, oldest last (RPC page order). */
  async function collectSignatures(
    address: PublicKey,
  ): Promise<{ signature: string; blockTime?: number | null; err?: unknown }[]> {
    const all: { signature: string; blockTime?: number | null; err?: unknown }[] =
      [];
    let before: string | undefined;
    for (;;) {
      const page = await rpc().getSignaturesForAddress(address, {
        before,
        limit: SIGNATURE_PAGE_LIMIT,
      });
      all.push(...page);
      const last = page[page.length - 1];
      if (page.length < SIGNATURE_PAGE_LIMIT || !last) return all;
      before = last.signature;
    }
  }

  /**
   * Parses one transaction as a batch commitment: fee payer must be this
   * adapter's authority (spoof guard) and the memo must round-trip to the
   * same batch PDA.
   */
  function parseBatchCommitment(
    pda: string,
    signature: string,
    tx: FetchedTransaction,
    fallbackBlockTime: number | null | undefined,
  ): ChainBatch | null {
    if (tx.meta?.err) return null;
    const feePayer = tx.transaction.message.staticAccountKeys[0];
    if (!feePayer || !feePayer.equals(authority.publicKey)) return null;

    for (const instruction of tx.transaction.message.compiledInstructions) {
      const program =
        tx.transaction.message.staticAccountKeys[instruction.programIdIndex];
      if (!program || !program.equals(MEMO_PROGRAM_ID)) continue;
      const memo = Buffer.from(instruction.data).toString("utf8");
      if (!memo.startsWith(`${BATCH_MEMO_PREFIX}:`)) continue;
      const [wallet, batchHash] = memo
        .slice(BATCH_MEMO_PREFIX.length + 1)
        .split(":");
      if (!wallet || !batchHash) continue;
      // A malformed wallet string in a third-party memo must not break
      // readback of legitimate commitments — skip it, don't throw.
      try {
        if (deriveBatchPda(wallet) !== pda) continue;
      } catch {
        continue;
      }
      const blockTime = tx.blockTime ?? fallbackBlockTime;
      return {
        pda,
        wallet,
        batchHash,
        signature,
        submittedAt: blockTime ? new Date(blockTime * 1000) : clock(),
      };
    }
    return null;
  }

  async function getBatch(pda: string): Promise<ChainBatch | null> {
    const signatures = await collectSignatures(new PublicKey(pda));
    // Oldest first: the first valid commitment is immutable, exactly like
    // an init-once account — later transactions can never override it.
    for (const entry of signatures.reverse()) {
      if (entry.err) continue;
      const tx = await rpc().getTransaction(entry.signature);
      if (!tx) continue;
      const batch = parseBatchCommitment(pda, entry.signature, tx, entry.blockTime);
      if (batch) return batch;
    }
    return null;
  }

  return {
    deriveQuestionPda,
    deriveBatchPda,

    async createQuestion(rule: ChainQuestionRule) {
      if (rule.locksAt.getTime() <= rule.opensAt.getTime()) {
        throw new ChainError("invalid_window", "locks_at must be after opens_at");
      }
      const pda = deriveQuestionPda(rule.ruleHash);
      const questionKey = new PublicKey(pda);
      if (await rpc().getAccountInfo(questionKey)) {
        throw new ChainError("question_exists", `question account in use: ${pda}`);
      }

      const data = coder.instruction.encode("create_question", {
        args: {
          rule_hash: Array.from(Buffer.from(rule.ruleHash, "hex")),
          fixture_id: rule.fixtureId,
          benchmark_fixture_id: rule.benchmarkFixtureId,
          stat_key_1: rule.statKey1,
          stat_key_2: rule.statKey2,
          operator: variant(OPERATOR_VARIANTS[rule.operator]),
          comparison: variant(COMPARISON_VARIANTS[rule.comparison]),
          threshold: rule.threshold === null ? null : new BN(rule.threshold),
          benchmark:
            rule.benchmarkValue === null ? null : new BN(rule.benchmarkValue),
          opens_at: new BN(Math.floor(rule.opensAt.getTime() / 1000)),
          locks_at: new BN(Math.floor(rule.locksAt.getTime() / 1000)),
        },
      });
      const instruction = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: questionKey, isSigner: false, isWritable: true },
          { pubkey: authority.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });

      try {
        await sendAndConfirm([instruction]);
      } catch (error) {
        throw toChainError(error, "create_question", pda);
      }
      return { pda };
    },

    async submitBatch(input: { wallet: string; batchHash: string }) {
      const pda = deriveBatchPda(input.wallet);
      if (await getBatch(pda)) {
        throw new ChainError("batch_exists", `batch account in use: ${pda}`);
      }

      const instructions = [
        // 0-lamport transfer only to index the batch PDA on the ledger so
        // getSignaturesForAddress(pda) finds this commitment.
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: new PublicKey(pda),
          lamports: 0,
        }),
        new TransactionInstruction({
          programId: MEMO_PROGRAM_ID,
          keys: [],
          data: Buffer.from(
            `${BATCH_MEMO_PREFIX}:${input.wallet}:${input.batchHash}`,
            "utf8",
          ),
        }),
      ];

      try {
        const signature = await sendAndConfirm(instructions);
        return { pda, signature };
      } catch (error) {
        throw toChainError(error, "submit_batch", pda);
      }
    },

    async settleQuestion(input: {
      questionPda: string;
      result: ChainQuestionResult;
    }) {
      const questionKey = new PublicKey(input.questionPda);
      const info = await rpc().getAccountInfo(questionKey);
      if (!info) {
        throw new ChainError("question_not_found", input.questionPda);
      }
      if (decodeQuestion(input.questionPda, info.data).status === "settled") {
        throw new ChainError("already_settled");
      }

      const data = coder.instruction.encode("settle_question", {
        result: variant(RESULT_VARIANTS[input.result]),
      });
      const instruction = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: questionKey, isSigner: false, isWritable: true },
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
        ],
        data,
      });

      try {
        const signature = await sendAndConfirm([instruction]);
        return { signature };
      } catch (error) {
        throw toChainError(error, "settle_question", input.questionPda);
      }
    },

    async getQuestion(pda: string) {
      const info = await rpc().getAccountInfo(new PublicKey(pda));
      if (!info) return null;
      return decodeQuestion(pda, info.data);
    },

    getBatch,
  };
}
