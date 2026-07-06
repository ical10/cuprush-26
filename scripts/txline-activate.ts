import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import nacl from "tweetnacl";

const RPC_URL = "https://api.devnet.solana.com";
const AUTH_ORIGIN = "https://txline-dev.txodds.com";
const API_BASE = "https://txline-dev.txodds.com/api";
const PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const TXL_MINT = new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SUBSCRIBE_DISCRIMINATOR = Buffer.from([254, 28, 191, 138, 156, 179, 183, 53]);
const SERVICE_LEVEL_ID = 1;
const WEEKS = 4;
const KEYFILE = ".txline-devnet-key.json";

async function expectOk(res: Response): Promise<Response> {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${body}`);
  }
  return res;
}

async function loadOrCreateKeypair(): Promise<Keypair> {
  const envKey = process.env.SOLANA_PRIVATE_KEY;
  if (envKey) {
    const secret = envKey.trim().startsWith("[")
      ? Uint8Array.from(JSON.parse(envKey) as number[])
      : (await import("bs58")).default.decode(envKey.trim());
    const kp = Keypair.fromSecretKey(secret);
    console.log(`Using SOLANA_PRIVATE_KEY wallet: ${kp.publicKey.toBase58()}`);
    return kp;
  }

  const argIndex = process.argv.indexOf("--keypair");
  const path = argIndex >= 0 ? process.argv[argIndex + 1] : KEYFILE;
  if (!path) throw new Error("--keypair requires a path");

  if (existsSync(path)) {
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
    console.log(`Loaded keypair from ${path}: ${kp.publicKey.toBase58()}`);
    return kp;
  }

  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)));
  chmodSync(path, 0o600);
  console.log(`Generated new keypair at ${path}: ${kp.publicKey.toBase58()}`);
  return kp;
}

async function ensureFunded(connection: Connection, pubkey: PublicKey): Promise<void> {
  const balance = await connection.getBalance(pubkey);
  console.log(`Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  if (balance >= 0.01 * LAMPORTS_PER_SOL) return;

  try {
    console.log("Requesting 1 SOL airdrop...");
    const sig = await connection.requestAirdrop(pubkey, LAMPORTS_PER_SOL);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
    const after = await connection.getBalance(pubkey);
    console.log(`Balance after airdrop: ${after / LAMPORTS_PER_SOL} SOL`);
  } catch (err) {
    console.error("Airdrop failed (devnet faucet is rate-limited).");
    console.error(`Fund this address manually, then re-run: ${pubkey.toBase58()}`);
    console.error("Faucet: https://faucet.solana.com");
    console.error(err);
    process.exit(1);
  }
}

async function getGuestJwt(): Promise<string> {
  const res = await expectOk(await fetch(`${AUTH_ORIGIN}/auth/guest/start`, { method: "POST" }));
  const { token } = (await res.json()) as { token: string };
  if (!token) throw new Error("guest/start returned no token");
  return token;
}

function deriveAta(owner: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), TXL_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

function createAtaIdempotentIx(payer: PublicKey, ata: PublicKey, owner: PublicKey): TransactionInstruction {
  // ATA program CreateIdempotent: discriminant 1, accounts per spl-associated-token-account spec
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    data: Buffer.from([1]),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: TXL_MINT, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

function subscribeIx(user: PublicKey, userAta: PublicKey): TransactionInstruction {
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], PROGRAM_ID);
  const [treasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], PROGRAM_ID);
  const treasuryVault = deriveAta(treasuryPda);

  const args = Buffer.alloc(3);
  args.writeUInt16LE(SERVICE_LEVEL_ID, 0);
  args.writeUInt8(WEEKS, 2);

  // subscribe per the tx-on-chain IDL: 8-byte discriminator + service_level_id u16 LE + weeks u8
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: Buffer.concat([SUBSCRIBE_DISCRIMINATOR, args]),
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: pricingMatrixPda, isSigner: false, isWritable: false },
      { pubkey: TXL_MINT, isSigner: false, isWritable: false },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: treasuryVault, isSigner: false, isWritable: true },
      { pubkey: treasuryPda, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

async function sendSubscribeTx(connection: Connection, keypair: Keypair): Promise<string> {
  const userAta = deriveAta(keypair.publicKey);
  const tx = new Transaction()
    .add(createAtaIdempotentIx(keypair.publicKey, userAta, keypair.publicKey))
    .add(subscribeIx(keypair.publicKey, userAta));

  console.log(`Subscribing: service level ${SERVICE_LEVEL_ID}, ${WEEKS} weeks...`);
  const txSig = await sendAndConfirmTransaction(connection, tx, [keypair], { commitment: "confirmed" });
  console.log(`Transaction confirmed: ${txSig}`);
  console.log(`Explorer: https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
  return txSig;
}

function signActivationMessage(txSig: string, jwt: string, keypair: Keypair): string {
  const message = `${txSig}::${jwt}`;
  const sig = nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey);
  return Buffer.from(sig).toString("base64");
}

async function activate(txSig: string, walletSignature: string, jwt: string): Promise<string> {
  const backoffs = [2000, 4000, 8000, 16000];
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await expectOk(
        await fetch(`${API_BASE}/token/activate`, {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}`, "Content-Type": "application/json" },
          body: JSON.stringify({ txSig, walletSignature, leagues: [] }),
        }),
      );
      const text = await res.text();
      return text.startsWith('"') ? (JSON.parse(text) as string) : text;
    } catch (err) {
      if (attempt === 5) throw err;
      const delay = backoffs[attempt - 1] ?? 16000;
      console.log(`Activation attempt ${attempt} failed (${String(err)}), retrying in ${delay / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("unreachable");
}

async function smokeTest(jwt: string, apiToken: string): Promise<void> {
  const res = await expectOk(
    await fetch(`${API_BASE}/fixtures/snapshot`, {
      headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
    }),
  );
  const fixtures = (await res.json()) as unknown[];
  if (!Array.isArray(fixtures)) throw new Error("fixtures/snapshot did not return a JSON array");
  console.log(`Smoke test passed: ${fixtures.length} fixture(s) in snapshot`);
}

async function main(): Promise<void> {
  const keypair = await loadOrCreateKeypair();
  const connection = new Connection(RPC_URL, "confirmed");

  await ensureFunded(connection, keypair.publicKey);

  const jwt = await getGuestJwt();
  console.log("Guest JWT acquired");

  const txSig = await sendSubscribeTx(connection, keypair);
  const walletSignature = signActivationMessage(txSig, jwt, keypair);

  const apiToken = await activate(txSig, walletSignature, jwt);
  await smokeTest(jwt, apiToken);

  const envPath = ".env";
  const keyLine = `TXLINE_API_KEY=${apiToken}`;
  const env = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const next = /^TXLINE_API_KEY=.*$/m.test(env)
    ? env.replace(/^TXLINE_API_KEY=.*$/m, keyLine)
    : `${env}${env && !env.endsWith("\n") ? "\n" : ""}${keyLine}\n`;
  writeFileSync(envPath, next, "utf8");

  console.log(`
✅ TxLINE devnet credentials active (service level ${SERVICE_LEVEL_ID})

TXLINE_API_KEY written to .env (txoracle_api_…${apiToken.slice(-4)})

Companion settings: TXLINE_BASE_URL=https://txline-dev.txodds.com and TXLINE_MODE=live
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
