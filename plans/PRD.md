# CupRush 26 — PRD (App-side PoC)

**Track:** Consumer and Fan Experiences (TxODDS) · **Deadline:** July 19, 2026 23:59 UTC
**Scope:** App-side implementation only. The Hermes AI player cohort and its MCP endpoint are explicitly out of scope.

## Goal

A mobile-first fan game where fans predict the match winner and quick stat outcomes (goals, cards, corners), save the prediction through Solana, watch the card react to live TxLINE events, and climb a leaderboard. A fan game — no deposits, wagers, tradable positions, or cash rewards.

## Users

- Casual soccer fans arriving via shared link or QR code, no crypto knowledge, mobile browser.
- Guests can browse and try a card; authentication is required only to save the first prediction.

## Core loop

1. Open the link. 2. Understand the question immediately. 3. Choose an outcome. 4. Save the prediction through Solana (sponsored, invisible wallet). 5. Watch the card react to live match events. 6. Receive a result and move on the leaderboard.

## Functional requirements

### Question generation and templates

- One primary match-winner card per fixture: "Will Team A score more goals than Team B?" (Yes/No). Team order randomized with a stable seed derived from fixture + template IDs.
- Secondary stat cards from a registry of verified deterministic templates over TxLINE-supported stats: total goals, yellow cards, red cards, corners. Outcomes: Yes, No, Higher, Lower; equal totals settle as Push.
- Template tiers: intra-fixture two-stat comparisons (incl. period keys) and inter-fixture benchmark questions (anchor a proven value from a completed fixture, then validate the new fixture against it — never a single two-stat proof).
- Stage budget: group stage 1 winner + 1 secondary; early knockouts +2 secondary; semis/final +3 secondary. Hard cap: 4 cards per fixture.
- Rotation heuristics: prefer corners/goals first, yellow cards only with a clear benchmark, red cards sparingly.
- LLM-assisted selection (OpenRouter, small model) chooses operator/predicate/wording at creation time (kickoff − 6h), constrained by a Zod schema to registry-supported values, with semantic checks (fixture exists, period supported, benchmark available, team order matches, rule within template). Short timeout, one retry, structured logging (latency, model, tokens, validation errors, fallback flag). On any failure: deterministic template selected from the fixture ID. Winner card never uses the LLM. Never runs in a request path.

### Question lifecycle

| State | Window | Behaviour |
|---|---|---|
| Scheduled | before kickoff − 6h | prepare templates and benchmarks |
| Open | kickoff − 6h → kickoff − 30m | accept one immutable choice per user |
| Locked | final 30m before kickoff | show choices, accept nothing new |
| Live | kickoff → terminal state | stream TxLINE stats; show locked choice |
| Settling | terminal → on-chain confirmation | validate result, submit settlement |
| Settled | within 30m of terminal | show result, points, streak, proof |
| Void | postponed/cancelled/abandoned | no point, streak preserved |

- A one-minute scheduler advances Scheduled→Open→Locked and scans pending predictions, settling questions, and overdue terminal fixtures. TxLINE events drive Live/Settling/Settled/Void.
- `opens_at`/`locks_at` stored in Postgres and the Question PDA; the program enforces them independently.

### Prediction submission

- One immutable prediction per participant per question, enforced by unique `(participant_id, question_id)` and PDA seeds.
- Idempotent flow: insert `pending` row → build Prediction PDA → submit sponsored transaction → mark `confirmed` with signature. Repeat requests return the existing row. Postgres-first crash: retry with capped backoff until lock, then `failed`. Chain-first crash: reconciler checks the deterministic PDA and repairs the row.
- No prediction can be created or changed after `locks_at` (checked in API and on-chain).

### TxLINE ingestion and live updates

- Backend owns TxLINE credentials and one authenticated stream; browsers never see the token. All external payloads Zod-validated and normalized before storage or relay.
- Ordering: `fixtures.last_seq` is the durable cursor; accept an event only if its sequence is newer, apply + advance atomically in one transaction. After reconnect, fetch a snapshot before resuming.
- Client updates via Server-Sent Events: snapshot first on (re)connect, then newer events, event ID `fixtureId:seq`. No WebSockets.

### Settlement and scoring

- Terminal fixture state triggers settlement. Conditional update claims `live→settling`; only the claiming process submits the settlement transaction. Question PDA refuses double settlement; retries read the on-chain result and repair Postgres.
- Match winner derives from the two final goal totals. Intra-fixture: one two-stat proof. Inter-fixture: proven benchmark then new-fixture proof. Supported ops: Add, Subtract, Equal, GreaterThan, LessThan — only through verified templates. Delayed proof → stay in `settling` and retry; never invent a result. Alert at 30m overdue.
- Scoring in one transaction: only rows with `scored_at IS NULL`, +1 point for correct, streak +1 on correct / reset on wrong / preserved on Push and Void, update cached counters, set `scored_at`. Counters are caches, rebuildable from settled predictions.
- Leaderboard: total correct, then longest streak. Share card: result, streak, next challenge, one tasteful sponsor slot. No billing.

### Auth, identity, wallet

- Privy passwordless email OTP. Backend verifies the Privy access token on every authenticated request and maps the Privy user ID to a `participant` (owner of wallet, profile, predictions, counters). Never trust a participant ID from a request body. No OTPs, passwords, raw tokens, or emails stored.
- Routes: `GET /api/me`, `PATCH /api/me` (schema-validated `displayName` only), `GET /api/leaderboard`, `POST /api/logout`, `POST /api/wallet/delegation/revoke`, `DELETE /api/me` (revoke delegation + anonymize off-chain profile; on-chain data survives — disclose before confirming).
- Privy embedded Solana wallet, created/unlocked behind the account. One explicit delegation approval; backend then submits only allowlisted game instructions. Wallet address visible; delegation revocable. Disclosure once: the app creates a wallet and may submit approved game transactions.
- Sponsored fees (Privy sponsorship preferred; custom fee payer only as fallback). Guardrails: allowlist CupRush 26 program ID + instruction shapes; reject transfers and unexpected account creation; per-wallet/question/session/IP limits; compute and spend caps; full audit logging. Never sign an opaque transaction. No prefunding user wallets.

### On-chain program (Anchor)

- One small program, devnet target, two accounts: **Question** (rule hash, fixture IDs, stat keys, operator, predicate, threshold/benchmark, opens_at, locks_at, result, status) and **Prediction** (question, player wallet, outcome, submitted timestamp, resolved flag, correctness).
- Three instructions: `create_question`, `submit_prediction`, `settle_question`. One Question PDA per question; one Prediction PDA per (wallet, question). `submit_prediction` enforces `opens_at`/`locks_at` on-chain.
- Inter-fixture: `create_question` proves the benchmark (Equal predicate) and stores it; `settle_question` validates the new fixture against it. Unprovable benchmark at open time → fall back to intra-fixture template.
- One proven question result reused for every prediction; never a per-user oracle call. A template enters the registry only after its TxOracle settlement test passes.

### Frontend PWA

- Card deck: swipe with always-available button fallback. Guest try-then-auth: drag before sign-in; save prompt on release ("Save your pick and start a streak." → "Locked on Solana.").
- Live progress card after kickoff: current stat vs. selected outcome, match minute/state, clear winning/losing state, small animation only on relevant stat change.
- Result/share card with sponsor slot; leaderboard screen; delayed-settlement state surfaced.
- No seed phrase, SOL requirement, wallet jargon, auth wall before first card, mandatory PWA install, or notification prompt during onboarding. One sentence per decision.

## Non-functional requirements

- Every Postgres+Solana dual write safe to retry (idempotency everywhere above).
- Zod validation at all trust boundaries: API input, TxLINE payloads, LLM output.
- Accessibility: buttons alongside gestures, no colour-only meaning, `prefers-reduced-motion` respected, mobile touch targets, full keyboard flow.
- Single process, in-memory live fixture state, Postgres for anything that must survive restart.

## Tech stack

| Layer | Choice |
|---|---|
| Client | Vite + React + vite-plugin-pwa |
| Service | Hono on Node.js (REST, SSE, ingestion, scheduler, settlement in one process) |
| Database | Postgres + Drizzle ORM |
| Validation | Zod + Hono Zod Validator |
| Auth/Wallet | Privy email OTP + embedded Solana wallet + sponsorship |
| Chain | One Anchor program, Solana devnet + TxLINE devnet (service level 1) |
| Live updates | Server-Sent Events |
| AI | Small OpenRouter model, deterministic fallback |
| Tests | Vitest (unit + integration against real Postgres) |

One TypeScript package, one lockfile, one deployment. `src/web` (PWA), `src/api` (routes, stream, scheduler, settlement), `src/db` (schema, queries). No monorepo tool, worker service, repository layer, or DI container.

### Database tables

`participants` (kind human/agent-reserved, unique nullable wallet, display name, non-negative cached points/current_streak/best_streak), `users` (unique participant FK, unique privy_user_id), `fixtures` (TxLINE ID as PK, teams, starts_at, game_state, last_seq), `questions` (fixture IDs, template, stat keys, operator, comparison, threshold, opens_at/locks_at/settled_at, status, result, attempt_count/next_retry_at/last_error, Question PDA, settlement signature, unique canonical rule hash), `predictions` (participant, question, outcome, PDA, chain status, tx signature, submitted_at/confirmed_at/scored_at, unique (participant_id, question_id), ON DELETE RESTRICT on participant).

## Delivery constraints (current environment)

- **No TxLINE credentials yet** → the TxLINE client supports a recorded-replay/demo mode driven by captured JSON fixture files; live mode is env-gated.
- **No Privy credentials yet** → Privy sits behind an env-gated adapter with a dev-mode auth stub so the full flow runs locally end-to-end.
- **No Docker; local Postgres 18 on the default socket** → integration tests run against a local test database. Node 22 + pnpm.
- **Anchor program ships as source** plus a TS chain adapter interface with an in-memory stub used by local dev and tests; devnet deploy is HITL.
- **HITL (tracked, not implemented):** Privy app + sponsorship funding, devnet program deploy, manual security review of all auth/user-data/delegation/sponsorship code, production deployment, demo video, submission. TxLINE devnet activation (service level 1) is already done.

## Out of scope

- Cash prizes, tokens, wagering; sports/stats beyond TxLINE's verified soccer feed; leagues, badges, streak shields, item economy; push notifications, native wrappers; Redis, BullMQ, WebSockets, microservices; on-chain points or leaderboard; Config/Benchmark/UserProfile PDAs; per-user oracle calls; separate worker/queue; horizontal scaling; phone login, recovery beyond email OTP, login-method linking; USDC fee payment; AI pundit (stretch only, post-core); **Hermes AI player cohort, agent tables, and MCP endpoint**.

## Definition of done

- The deployed app works during a match.
- TxLINE devnet (service level 1) supplies live World Cup input.
- A fan can complete the flow without owning SOL.
- Email OTP restores the same identity and wallet.
- Drizzle migrations create all five constrained core tables.
- The embedded wallet and delegation are disclosed once, then stay out of the way.
- The prediction is recorded through Solana.
- No prediction can be created or changed after `locks_at`.
- Live events update the card without refresh.
- Match-winner, intra-fixture, and inter-fixture questions settle correctly.
- Settlement normally confirms on-chain within 30 minutes of the terminal match state.
- Yes, No, Higher, Lower, Push, void, and reconnect paths behave correctly.
- Vitest unit and integration suites pass.
- The public repository includes setup instructions and TxLINE endpoints.
- The demo video is under five minutes and shows the full journey.
- The submission includes candid feedback about the TxLINE API.

Items requiring live credentials, devnet deploys, deployment, or human sign-off are delivered as HITL-ready: code complete, tested against stubs/replay, documented for the human gate.
