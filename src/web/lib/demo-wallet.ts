const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * A random base58 string shaped like a Solana address (44 chars), for the
 * dev/Privy-stub login paths only — there is no real wallet behind it. Real
 * embedded wallets come from Privy once credentials exist (see
 * src/web/auth/privy-auth-stub.tsx). Satisfies the server's address format
 * check (src/api/routes/account.ts) so a demo login can immediately submit
 * predictions instead of 400ing on a missing wallet.
 */
export function randomDemoWalletAddress(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(44));
  let address = "";
  for (const byte of bytes) {
    address += BASE58_ALPHABET[byte % BASE58_ALPHABET.length];
  }
  return address;
}
