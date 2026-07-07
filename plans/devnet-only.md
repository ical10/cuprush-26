# Plan: devnet-only — production runs on Solana devnet

Decision (2026-07-07): no mainnet anywhere. The production app deploys against
**devnet**: devnet Solana program, devnet TxLINE (`txline-dev.txodds.com`,
service level 1, creds already held). All mainnet references become devnet or
are deleted.

## Sweep surface

- **Code**: `src/chain/solana.ts` (+ tests) — comments/defaults naming
  mainnet; any `mainnet-beta` RPC defaults → devnet.
- **Scripts**: `scripts/txline-activate.ts` — fine as-is (devnet constants);
  drop any "--mainnet later" notes if present.
- **Docs**: README (deploy/env sections), plans/PRD.md,
  worldcup-hilo-hackathon-research.md, plans/railway-cicd.md (env contract
  "Production (post-#13)" column), plans/txline-devnet-activation.md +
  plans/txline-live-client-rework.md (out-of-scope "mainnet" follow-ups),
  hermes-agent-plan.md if it names mainnet.
- **GitHub issues**: #13 (mainnet checklist items → devnet equivalents:
  deploy program to devnet, devnet smoke test; TxLINE level 12 → level 1
  devnet DONE), #16 (mainnet mentions). Edit via `gh issue edit` / comment.
- **Keep untouched**: captured fixtures, git history, TxLINE docs quotes
  that factually describe TxLINE's own mainnet program (change only OUR
  plans/targets, not descriptions of what TxLINE offers).

## Semantics, not find-replace

"Mainnet smoke test" → "devnet smoke test"; "deploy to mainnet" → "deploy to
devnet"; "TxLINE level 12 mainnet creds" → "devnet level-1 creds (done)".
Sentences that only make sense for mainnet (sponsorship funding real SOL) get
rewritten for devnet reality, not word-swapped.

## Workflow

Feature branch `devnet-only` off origin/staging → sweep → suites green →
squash-merge to staging → staging auto-deploys → HITL promote later.
