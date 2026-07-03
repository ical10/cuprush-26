import { describe, expect, it } from "vitest";
import { createChainAdapterFromEnv } from "./index";
import { createSolanaChainAdapter } from "./solana";

describe("createSolanaChainAdapter", () => {
  it("throws not_configured without SOLANA_RPC_URL and HILO_PROGRAM_ID", () => {
    expect(() => createSolanaChainAdapter({})).toThrowError(/not configured/i);
    expect(() => createSolanaChainAdapter({ SOLANA_RPC_URL: "https://rpc" })).toThrowError(
      /not configured/i,
    );
    expect(() =>
      createSolanaChainAdapter({ HILO_PROGRAM_ID: "2Yon9VrntK9ASpvHRJ1NzeTFBziWtUWPYVBZZWdk68to" }),
    ).toThrowError(/not configured/i);
  });

  it("is a HITL skeleton: methods throw even when configured", async () => {
    const adapter = createSolanaChainAdapter({
      SOLANA_RPC_URL: "https://rpc",
      HILO_PROGRAM_ID: "2Yon9VrntK9ASpvHRJ1NzeTFBziWtUWPYVBZZWdk68to",
    });
    await expect(adapter.getQuestion("pda")).rejects.toThrowError(/HITL/);
  });
});

describe("createChainAdapterFromEnv", () => {
  it("defaults to the stub adapter", () => {
    const adapter = createChainAdapterFromEnv({});
    expect(adapter.deriveQuestionPda("a".repeat(64))).toBeTypeOf("string");
  });

  it("selects the solana adapter with CHAIN_MODE=solana", () => {
    expect(() => createChainAdapterFromEnv({ CHAIN_MODE: "solana" })).toThrowError(
      /not configured/i,
    );
  });
});
