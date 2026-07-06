# Plan: TxLINE devnet credential activation (service level 1)

## Goal
Prove the TxLINE credential pipeline on **devnet** with a throwaway wallet — no
real SOL, no TxL tokens. Produce a devnet `X-Api-Token`, confirm a data call
returns. Validates the flow before any mainnet level-12 run.

## Scope
Devnet only. Service level 1 (World Cup + International Friendlies, 60s delay),
empty leagues (standard bundle). Does NOT touch the app's `live-client.ts` —
that rework (2 headers, SSE, real endpoints, JWT refresh) is a separate
follow-up once a token is proven.

## New devDependencies (script tooling only, never in the app bundle)
- `@solana/web3.js` — Connection, Keypair, Transaction, PDA derivation
- `tweetnacl` — detached message signature for activation
- `bs58` — decode a base58 `SOLANA_PRIVATE_KEY` env wallet (user-funded devnet
  wallet takes precedence over the throwaway keyfile)

No `@coral-xyz/anchor`, no `@solana/spl-token`: the `subscribe` instruction is
hand-rolled — 8-byte discriminator (verified from the published IDL) + u16 LE +
u8 = 11 bytes of data, 9 accounts in known order. ATA derivation is one
`findProgramAddressSync([owner, tokenProgramId, mint], ATA_PROGRAM)`; manual
derivation also sidesteps spl-token's `allowOwnerOffCurve` trap for the
PDA-owned treasury vault. Both deps long-established (pass min-release-age).

## Verified constants (from docs + IDL at github.com/txodds/tx-on-chain)
- RPC `https://api.devnet.solana.com`
- **Two API bases** (auth is NOT under /api):
  - `AUTH_ORIGIN = https://txline-dev.txodds.com` → `POST /auth/guest/start`
  - `API_BASE = https://txline-dev.txodds.com/api` → `POST /token/activate`,
    `GET /fixtures/snapshot`
  - OpenAPI lists devnet as `http://`; use https, warn + fall back to http
    only if TLS fails.
- Program `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- TxL mint `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG`, **Token-2022**
  (`TOKEN_2022_PROGRAM_ID`, not legacy SPL Token)
- PDAs: seeds `token_treasury_v2`, `pricing_matrix` under the program
- Treasury vault = ATA of TxL mint owned by the treasury **PDA** (off-curve
  owner — fine with manual derivation)
- `subscribe` discriminator `[254, 28, 191, 138, 156, 179, 183, 53]`,
  args `service_level_id=1: u16 LE`, `weeks=4: u8` (must be multiple of 4)
- Accounts order: user (w,s), pricing_matrix, token_mint, user_token_account
  (w), token_treasury_vault (w), token_treasury_pda, token_program,
  system_program, associated_token_program
- Activation message: `` `${txSig}:${leagues.join(",")}:${jwt}` `` — empty
  leagues → `` `${txSig}::${jwt}` `` (double colon)

## New file: `scripts/txline-activate.ts`
Run: `tsx scripts/txline-activate.ts [--keypair <path>]` (default: generate a
throwaway keypair at `.txline-devnet-key.json` in repo root).

Steps:
1. Add `.txline-devnet-key.json` to `.gitignore` (explicit step, part of the
   diff). Load or generate the keypair; never log the secret.
2. Balance check: need ~0.01 SOL (ATA rent ~0.002 + fees). If short, request
   airdrop; **devnet faucet is rate-limited** — on airdrop failure, print the
   pubkey + `https://faucet.solana.com` and exit 1 cleanly. Re-run resumes.
3. `POST ${AUTH_ORIGIN}/auth/guest/start` (empty body) → `{token}` guest JWT.
4. Build one tx: `createAssociatedTokenAccountIdempotent`-equivalent ix for
   the user's TxL ATA (Token-2022; idempotent — no-op if it exists) followed
   by the hand-rolled `subscribe(1, 4)` ix. Send, await `confirmed` → `txSig`.
5. Sign `` `${txSig}::${jwt}` `` with `nacl.sign.detached(message,
   keypair.secretKey)`, base64-encode.
6. `POST ${API_BASE}/token/activate` body `{txSig, walletSignature,
   leagues: []}` + `Authorization: Bearer ${jwt}`. **Retry up to 5× with
   backoff (2s, 4s, 8s…)** — the off-chain server validates txSig on-chain
   and may lag right after confirmation. → plain-text `txoracle_api_…`.
7. Smoke test: `GET ${API_BASE}/fixtures/snapshot` with BOTH headers
   (`Authorization: Bearer ${jwt}` + `X-Api-Token`). Assert HTTP 200 + JSON
   array; empty array is still a pass (no fixtures that epoch day) — print
   count either way.
8. Print both credentials + paste-ready `.env` lines:
   `TXLINE_JWT=…` (30-day expiry, reacquire on 401) and
   `TXLINE_API_KEY=…` (the X-Api-Token). Note explicitly: current app only
   reads `TXLINE_API_KEY` and its live client speaks the wrong wire shape —
   both fixed in the follow-up rework, not here.

## Re-run semantics
Safe. A second `subscribe` extends validity (+4 weeks); activation re-issues a
token; ATA creation is idempotent. No guards needed — document, don't code.

## Guardrails
- Devnet only; no mainnet RPC, no real funds anywhere in the script.
- Throwaway key gitignored; secret never logged or committed.
- Validate every TxLINE HTTP response (non-2xx → throw with status + body).
- JWT and API token go to stdout only (dev creds by design); nothing else
  sensitive printed.

## Check (ponytail: one runnable check)
The script IS the check — step 7's authenticated snapshot call fails loudly if
any prior step produced bad creds. No separate test file for a one-off script.

## Out of scope (follow-ups)
- `live-client.ts` rework to the real API (2 headers, SSE, real endpoints,
  JWT refresh loop for the 30-day expiry).
- Mainnet level-12 activation with the user's funded wallet (same script,
  mainnet constants + `--mainnet` flag later).
- Settlement integration with TxOracle `validateStat` (Add/Subtract/Equal/
  GreaterThan/LessThan, Merkle-proof accounts): adopt `@coral-xyz/anchor`
  there — multiple instructions + nontrivial account structs justify the
  IDL-driven client. Hand-rolling was right for this one-off single
  instruction only.
