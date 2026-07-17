import { Buffer } from "node:buffer";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { BN, BorshCoder, utils, type Idl } from "@coral-xyz/anchor";
import { describe, expect, it } from "vitest";
import { ChainError, isChainError, type ChainQuestionRule } from "./adapter";
import { createChainAdapterFromEnv } from "./index";
import {
  BATCH_MEMO_PREFIX,
  MEMO_PROGRAM_ID,
  createSolanaChainAdapter,
  type FetchedTransaction,
  type SolanaRpc,
} from "./solana";
import idlJson from "./idl/cuprush.json";

const PROGRAM_ID = "9u7uuj7S8kMon564b4TA8Gc7RaYXSC5QgjDz8fFgmGCU";
const AUTHORITY = Keypair.generate();
const WALLET = Keypair.generate().publicKey.toBase58();
const RULE_HASH = "ab".repeat(32);
const BLOCKHASH = Keypair.generate().publicKey.toBase58();

const coder = new BorshCoder(idlJson as Idl);

const env = {
  CUPRUSH_PROGRAM_ID: PROGRAM_ID,
  SOLANA_PRIVATE_KEY: JSON.stringify(Array.from(AUTHORITY.secretKey)),
};

const now = new Date("2026-07-01T12:00:00Z");
const clock = () => now;

function rule(overrides: Partial<ChainQuestionRule> = {}): ChainQuestionRule {
  return {
    ruleHash: RULE_HASH,
    fixtureId: "fixture-1",
    benchmarkFixtureId: null,
    statKey1: "home.full_time.goals",
    statKey2: "away.full_time.goals",
    operator: "subtract",
    comparison: "greater_than",
    threshold: 0,
    benchmarkValue: null,
    opensAt: new Date(now.getTime() - 60_000),
    locksAt: new Date(now.getTime() + 60_000),
    ...overrides,
  };
}

type FakeRpc = SolanaRpc & { sent: VersionedTransaction[] };

function fakeRpc(overrides: Partial<SolanaRpc> = {}): FakeRpc {
  const sent: VersionedTransaction[] = [];
  return {
    sent,
    getAccountInfo: () => Promise.resolve(null),
    getLatestBlockhash: () =>
      Promise.resolve({ blockhash: BLOCKHASH, lastValidBlockHeight: 100 }),
    sendRawTransaction: (raw) => {
      sent.push(VersionedTransaction.deserialize(raw));
      return Promise.resolve(`fake-signature-${sent.length}`);
    },
    confirmTransaction: () => Promise.resolve({ value: { err: null } }),
    getSignaturesForAddress: () => Promise.resolve([]),
    getTransaction: () => Promise.resolve(null),
    ...overrides,
  };
}

function adapterWith(rpc: SolanaRpc) {
  return createSolanaChainAdapter(env, { connection: rpc, clock });
}

function instructionsOf(tx: VersionedTransaction) {
  const keys = tx.message.staticAccountKeys;
  return tx.message.compiledInstructions.map((instruction) => ({
    programId: keys[instruction.programIdIndex] as PublicKey,
    accounts: instruction.accountKeyIndexes.map((i) => keys[i] as PublicKey),
    data: Buffer.from(instruction.data),
  }));
}

function batchCommitmentTx(
  feePayer: PublicKey,
  memo: string,
  blockTime = 1_751_000_000,
): FetchedTransaction {
  return {
    blockTime,
    meta: { err: null },
    transaction: {
      message: {
        staticAccountKeys: [feePayer, MEMO_PROGRAM_ID],
        compiledInstructions: [
          { programIdIndex: 1, data: Uint8Array.from(Buffer.from(memo, "utf8")) },
        ],
      },
    },
  };
}

describe("solana adapter configuration (fail closed)", () => {
  it("requires CUPRUSH_PROGRAM_ID and SOLANA_PRIVATE_KEY", () => {
    expect(() => createSolanaChainAdapter({})).toThrowError(/not configured/i);
    expect(() =>
      createSolanaChainAdapter({ CUPRUSH_PROGRAM_ID: PROGRAM_ID }),
    ).toThrowError(/SOLANA_PRIVATE_KEY/);
    expect(() =>
      createSolanaChainAdapter({ SOLANA_PRIVATE_KEY: env.SOLANA_PRIVATE_KEY }),
    ).toThrowError(/CUPRUSH_PROGRAM_ID/);
    try {
      createSolanaChainAdapter({});
      expect.unreachable("construction must fail");
    } catch (error) {
      expect(isChainError(error, "not_configured")).toBe(true);
    }
  });

  it("rejects an invalid program id as not_configured", () => {
    expect(() =>
      createSolanaChainAdapter({
        CUPRUSH_PROGRAM_ID: "not-a-key",
        SOLANA_PRIVATE_KEY: env.SOLANA_PRIVATE_KEY,
      }),
    ).toThrowError(/CUPRUSH_PROGRAM_ID is not a valid public key/);
  });

  it("rejects bad key material without echoing the secret", () => {
    const secret = "super-secret-not-a-key";
    try {
      createSolanaChainAdapter({
        CUPRUSH_PROGRAM_ID: PROGRAM_ID,
        SOLANA_PRIVATE_KEY: secret,
      });
      expect.unreachable("construction must fail");
    } catch (error) {
      expect(isChainError(error, "not_configured")).toBe(true);
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("accepts a base58-encoded secret key too", () => {
    const adapter = createSolanaChainAdapter(
      {
        CUPRUSH_PROGRAM_ID: PROGRAM_ID,
        SOLANA_PRIVATE_KEY: utils.bytes.bs58.encode(AUTHORITY.secretKey),
      },
      { connection: fakeRpc() },
    );
    expect(adapter.deriveQuestionPda(RULE_HASH)).toBeTypeOf("string");
  });

  it("is constructible offline (no RPC until first use)", () => {
    const adapter = createSolanaChainAdapter(env);
    expect(adapter.deriveQuestionPda(RULE_HASH)).toBeTypeOf("string");
    expect(adapter.deriveBatchPda(WALLET)).toBeTypeOf("string");
  });
});

describe("solana PDA derivation", () => {
  it('derives the question PDA from program seeds [b"question", rule_hash]', () => {
    const adapter = adapterWith(fakeRpc());
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("question"), Buffer.from(RULE_HASH, "hex")],
      new PublicKey(PROGRAM_ID),
    );
    expect(adapter.deriveQuestionPda(RULE_HASH)).toBe(expected.toBase58());
  });

  it('derives the batch PDA from seeds [b"batch", wallet]', () => {
    const adapter = adapterWith(fakeRpc());
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from("batch"), new PublicKey(WALLET).toBuffer()],
      new PublicKey(PROGRAM_ID),
    );
    expect(adapter.deriveBatchPda(WALLET)).toBe(expected.toBase58());
  });

  it("is deterministic and different per input", () => {
    const adapter = adapterWith(fakeRpc());
    expect(adapter.deriveQuestionPda(RULE_HASH)).toBe(
      adapter.deriveQuestionPda(RULE_HASH),
    );
    expect(adapter.deriveQuestionPda("cd".repeat(32))).not.toBe(
      adapter.deriveQuestionPda(RULE_HASH),
    );
  });

  it("rejects a non-hex rule hash", () => {
    const adapter = adapterWith(fakeRpc());
    expect(() => adapter.deriveQuestionPda("nope")).toThrowError(/hex/);
  });
});

describe("solana createQuestion", () => {
  it("encodes the create_question instruction against the program", async () => {
    const rpc = fakeRpc();
    const adapter = adapterWith(rpc);

    const { pda } = await adapter.createQuestion(rule());
    expect(pda).toBe(adapter.deriveQuestionPda(RULE_HASH));
    expect(rpc.sent).toHaveLength(1);

    const [instruction] = instructionsOf(rpc.sent[0] as VersionedTransaction);
    expect(instruction?.programId.toBase58()).toBe(PROGRAM_ID);
    expect(instruction?.accounts.map((k) => k.toBase58())).toEqual([
      pda,
      AUTHORITY.publicKey.toBase58(),
      "11111111111111111111111111111111",
    ]);

    const decoded = coder.instruction.decode(instruction?.data as Buffer);
    expect(decoded?.name).toBe("create_question");
    const args = (decoded?.data as { args: Record<string, unknown> }).args;
    expect(Buffer.from(args.rule_hash as number[]).toString("hex")).toBe(RULE_HASH);
    expect(args.fixture_id).toBe("fixture-1");
    expect(args.benchmark_fixture_id).toBeNull();
    expect(args.stat_key_1).toBe("home.full_time.goals");
    expect(args.operator).toEqual({ Subtract: {} });
    expect(args.comparison).toEqual({ GreaterThan: {} });
    expect((args.threshold as BN).toNumber()).toBe(0);
    expect(args.benchmark).toBeNull();
    expect((args.opens_at as BN).toNumber()).toBe(
      Math.floor(rule().opensAt.getTime() / 1000),
    );
    expect((args.locks_at as BN).toNumber()).toBe(
      Math.floor(rule().locksAt.getTime() / 1000),
    );
  });

  it("rejects locks_at <= opens_at before any RPC call", async () => {
    const rpc = fakeRpc({
      getAccountInfo: () => Promise.reject(new Error("must not be called")),
    });
    const adapter = adapterWith(rpc);
    await expect(
      adapter.createQuestion(rule({ locksAt: rule().opensAt })),
    ).rejects.toMatchObject({ code: "invalid_window" });
  });

  it("maps an existing account to question_exists without sending", async () => {
    const rpc = fakeRpc({
      getAccountInfo: () => Promise.resolve({ data: Buffer.alloc(0) }),
    });
    const adapter = adapterWith(rpc);
    await expect(adapter.createQuestion(rule())).rejects.toMatchObject({
      code: "question_exists",
    });
    expect(rpc.sent).toHaveLength(0);
  });

  it("maps an 'already in use' send failure to question_exists", async () => {
    const error = Object.assign(new Error("Simulation failed"), {
      logs: [
        "Allocate: account Address { address: 9xQe..., base: None } already in use",
      ],
    });
    const adapter = adapterWith(
      fakeRpc({ sendRawTransaction: () => Promise.reject(error) }),
    );
    await expect(adapter.createQuestion(rule())).rejects.toMatchObject({
      code: "question_exists",
    });
  });

  it("maps program error 6000 from confirmation to invalid_window", async () => {
    const adapter = adapterWith(
      fakeRpc({
        confirmTransaction: () =>
          Promise.resolve({
            value: { err: { InstructionError: [0, { Custom: 6000 }] } },
          }),
      }),
    );
    await expect(adapter.createQuestion(rule())).rejects.toMatchObject({
      code: "invalid_window",
    });
  });

  it("lets blockhash expiry stay a plain retryable error", async () => {
    const adapter = adapterWith(
      fakeRpc({
        confirmTransaction: () =>
          Promise.reject(
            new Error("Signature abc has expired: block height exceeded"),
          ),
      }),
    );
    const failure = await adapter.createQuestion(rule()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ChainError);
    expect((failure as Error).message).toMatch(/block height exceeded/);
  });

  it("lets insufficient fee-payer funds stay a plain retryable error", async () => {
    const error = Object.assign(new Error("Simulation failed"), {
      logs: ["Transfer: insufficient lamports 0, need 1461600"],
    });
    const adapter = adapterWith(
      fakeRpc({ sendRawTransaction: () => Promise.reject(error) }),
    );
    const failure = await adapter.createQuestion(rule()).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ChainError);
  });
});

describe("solana submitBatch (memo commitment)", () => {
  const HASH = "b".repeat(64);

  it("commits the batch hash in a memo referencing the batch PDA", async () => {
    const rpc = fakeRpc();
    const adapter = adapterWith(rpc);

    const { pda, signature } = await adapter.submitBatch({
      wallet: WALLET,
      batchHash: HASH,
    });
    expect(pda).toBe(adapter.deriveBatchPda(WALLET));
    expect(signature).toBe("fake-signature-1");

    const instructions = instructionsOf(rpc.sent[0] as VersionedTransaction);
    expect(instructions).toHaveLength(2);

    const transfer = instructions[0];
    expect(transfer?.programId.toBase58()).toBe(
      "11111111111111111111111111111111",
    );
    expect(transfer?.accounts[1]?.toBase58()).toBe(pda);

    const memo = instructions[1];
    expect(memo?.programId.equals(MEMO_PROGRAM_ID)).toBe(true);
    expect(memo?.data.toString("utf8")).toBe(
      `${BATCH_MEMO_PREFIX}:${WALLET}:${HASH}`,
    );
  });

  it("rejects a second batch for the same wallet with batch_exists", async () => {
    const adapter = adapterWith(
      fakeRpc({
        getSignaturesForAddress: () =>
          Promise.resolve([{ signature: "sig-old", blockTime: 1_751_000_000 }]),
        getTransaction: () =>
          Promise.resolve(
            batchCommitmentTx(
              AUTHORITY.publicKey,
              `${BATCH_MEMO_PREFIX}:${WALLET}:${HASH}`,
            ),
          ),
      }),
    );
    await expect(
      adapter.submitBatch({ wallet: WALLET, batchHash: "c".repeat(64) }),
    ).rejects.toMatchObject({ code: "batch_exists" });
  });
});

describe("solana getBatch", () => {
  const HASH = "d".repeat(64);

  it("returns null when nothing references the PDA", async () => {
    const adapter = adapterWith(fakeRpc());
    expect(await adapter.getBatch(adapter.deriveBatchPda(WALLET))).toBeNull();
  });

  it("returns the oldest valid commitment and parses the memo", async () => {
    const txs: Record<string, FetchedTransaction> = {
      "sig-new": batchCommitmentTx(
        AUTHORITY.publicKey,
        `${BATCH_MEMO_PREFIX}:${WALLET}:${"e".repeat(64)}`,
        1_751_000_100,
      ),
      "sig-old": batchCommitmentTx(
        AUTHORITY.publicKey,
        `${BATCH_MEMO_PREFIX}:${WALLET}:${HASH}`,
        1_751_000_000,
      ),
    };
    const adapter = adapterWith(
      fakeRpc({
        // Newest first, like the RPC returns them.
        getSignaturesForAddress: () =>
          Promise.resolve([
            { signature: "sig-new", blockTime: 1_751_000_100 },
            { signature: "sig-old", blockTime: 1_751_000_000 },
          ]),
        getTransaction: (signature) => Promise.resolve(txs[signature] ?? null),
      }),
    );

    const batch = await adapter.getBatch(adapter.deriveBatchPda(WALLET));
    expect(batch).toMatchObject({
      pda: adapter.deriveBatchPda(WALLET),
      wallet: WALLET,
      batchHash: HASH,
      signature: "sig-old",
      submittedAt: new Date(1_751_000_000 * 1000),
    });
  });

  it("ignores commitments not fee-paid by the adapter authority", async () => {
    const spoofer = Keypair.generate().publicKey;
    const adapter = adapterWith(
      fakeRpc({
        getSignaturesForAddress: () =>
          Promise.resolve([{ signature: "sig-spoof", blockTime: 1 }]),
        getTransaction: () =>
          Promise.resolve(
            batchCommitmentTx(spoofer, `${BATCH_MEMO_PREFIX}:${WALLET}:${HASH}`),
          ),
      }),
    );
    expect(await adapter.getBatch(adapter.deriveBatchPda(WALLET))).toBeNull();
  });

  it("ignores failed transactions and memos for other wallets", async () => {
    const otherWallet = Keypair.generate().publicKey.toBase58();
    const adapter = adapterWith(
      fakeRpc({
        getSignaturesForAddress: () =>
          Promise.resolve([
            { signature: "sig-failed", blockTime: 1, err: { some: "error" } },
            { signature: "sig-other", blockTime: 1 },
          ]),
        getTransaction: (signature) =>
          Promise.resolve(
            signature === "sig-other"
              ? batchCommitmentTx(
                  AUTHORITY.publicKey,
                  `${BATCH_MEMO_PREFIX}:${otherWallet}:${HASH}`,
                )
              : null,
          ),
      }),
    );
    expect(await adapter.getBatch(adapter.deriveBatchPda(WALLET))).toBeNull();
  });
});

async function encodedQuestion(
  overrides: Partial<Record<string, unknown>> = {},
): Promise<Buffer> {
  return coder.accounts.encode("Question", {
    authority: AUTHORITY.publicKey,
    rule_hash: Array.from(Buffer.from(RULE_HASH, "hex")),
    fixture_id: "fixture-1",
    benchmark_fixture_id: null,
    stat_key_1: "home.full_time.goals",
    stat_key_2: "away.full_time.goals",
    operator: { Subtract: {} },
    comparison: { GreaterThan: {} },
    threshold: new BN(0),
    benchmark: null,
    opens_at: new BN(Math.floor(rule().opensAt.getTime() / 1000)),
    locks_at: new BN(Math.floor(rule().locksAt.getTime() / 1000)),
    status: { Open: {} },
    result: null,
    bump: 254,
    ...overrides,
  });
}

describe("solana settleQuestion", () => {
  it("maps a missing account to question_not_found", async () => {
    const adapter = adapterWith(fakeRpc());
    await expect(
      adapter.settleQuestion({
        questionPda: Keypair.generate().publicKey.toBase58(),
        result: "push",
      }),
    ).rejects.toMatchObject({ code: "question_not_found" });
  });

  it("refuses to settle an already settled question without sending", async () => {
    const data = await encodedQuestion({
      status: { Settled: {} },
      result: { Yes: {} },
    });
    const rpc = fakeRpc({
      getAccountInfo: () => Promise.resolve({ data }),
    });
    const adapter = adapterWith(rpc);
    await expect(
      adapter.settleQuestion({
        questionPda: adapter.deriveQuestionPda(RULE_HASH),
        result: "no",
      }),
    ).rejects.toMatchObject({ code: "already_settled" });
    expect(rpc.sent).toHaveLength(0);
  });

  it("encodes settle_question with the result enum", async () => {
    const data = await encodedQuestion();
    const rpc = fakeRpc({
      getAccountInfo: () => Promise.resolve({ data }),
    });
    const adapter = adapterWith(rpc);
    const questionPda = adapter.deriveQuestionPda(RULE_HASH);

    const { signature } = await adapter.settleQuestion({
      questionPda,
      result: "push",
    });
    expect(signature).toBe("fake-signature-1");

    const [instruction] = instructionsOf(rpc.sent[0] as VersionedTransaction);
    expect(instruction?.programId.toBase58()).toBe(PROGRAM_ID);
    expect(instruction?.accounts.map((k) => k.toBase58())).toEqual([
      questionPda,
      AUTHORITY.publicKey.toBase58(),
    ]);
    const decoded = coder.instruction.decode(instruction?.data as Buffer);
    expect(decoded?.name).toBe("settle_question");
    expect((decoded?.data as { result: unknown }).result).toEqual({ Push: {} });
  });

  it("maps program error 6006 (AlreadySettled) to already_settled", async () => {
    const data = await encodedQuestion();
    const error = Object.assign(new Error("Simulation failed"), {
      logs: [
        "Program log: AnchorError thrown. Error Code: AlreadySettled. Error Number: 6006.",
        "Program failed: custom program error: 0x1776",
      ],
    });
    const adapter = adapterWith(
      fakeRpc({
        getAccountInfo: () => Promise.resolve({ data }),
        sendRawTransaction: () => Promise.reject(error),
      }),
    );
    await expect(
      adapter.settleQuestion({
        questionPda: adapter.deriveQuestionPda(RULE_HASH),
        result: "yes",
      }),
    ).rejects.toMatchObject({ code: "already_settled" });
  });
});

describe("solana getQuestion", () => {
  it("returns null for a missing account", async () => {
    const adapter = adapterWith(fakeRpc());
    expect(
      await adapter.getQuestion(Keypair.generate().publicKey.toBase58()),
    ).toBeNull();
  });

  it("decodes the Question account into the adapter shape", async () => {
    const data = await encodedQuestion({
      benchmark_fixture_id: "fixture-0",
      benchmark: new BN(3),
      threshold: null,
      comparison: { LessThan: {} },
      operator: { Add: {} },
      status: { Settled: {} },
      result: { Push: {} },
    });
    const adapter = adapterWith(
      fakeRpc({ getAccountInfo: () => Promise.resolve({ data }) }),
    );
    const pda = adapter.deriveQuestionPda(RULE_HASH);

    expect(await adapter.getQuestion(pda)).toEqual({
      pda,
      authority: AUTHORITY.publicKey.toBase58(),
      ruleHash: RULE_HASH,
      fixtureId: "fixture-1",
      benchmarkFixtureId: "fixture-0",
      statKey1: "home.full_time.goals",
      statKey2: "away.full_time.goals",
      operator: "add",
      comparison: "less_than",
      threshold: null,
      benchmarkValue: 3,
      opensAt: rule().opensAt,
      locksAt: rule().locksAt,
      status: "settled",
      result: "push",
    });
  });

  it("decodes a Void status as void (not settled)", async () => {
    const data = await encodedQuestion({ status: { Void: {} }, result: null });
    const adapter = adapterWith(
      fakeRpc({ getAccountInfo: () => Promise.resolve({ data }) }),
    );
    const question = await adapter.getQuestion(
      adapter.deriveQuestionPda(RULE_HASH),
    );
    expect(question?.status).toBe("void");
    expect(question?.result).toBeNull();
  });

  it("exposes the configured authority pubkey and decodes it", async () => {
    const data = await encodedQuestion();
    const adapter = adapterWith(
      fakeRpc({ getAccountInfo: () => Promise.resolve({ data }) }),
    );
    expect(adapter.authorityPubkey).toBe(AUTHORITY.publicKey.toBase58());
    const question = await adapter.getQuestion(
      adapter.deriveQuestionPda(RULE_HASH),
    );
    expect(question?.authority).toBe(AUTHORITY.publicKey.toBase58());
  });
});

describe("createChainAdapterFromEnv", () => {
  it("defaults to the stub adapter", () => {
    const adapter = createChainAdapterFromEnv({});
    expect(adapter.deriveQuestionPda("a".repeat(64))).toBeTypeOf("string");
  });

  it("selects the solana adapter with CHAIN_MODE=solana and fails closed", () => {
    expect(() =>
      createChainAdapterFromEnv({ CHAIN_MODE: "solana" }),
    ).toThrowError(/not configured/i);
  });
});
