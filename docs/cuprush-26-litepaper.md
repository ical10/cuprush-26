# CupRush 26 Litepaper

**The match is live. Make your call. Be the winner.**

CupRush 26 turns tournament match-watching into a fast mobile prediction game. Fans swipe through live match questions, lock their picks through a sponsored Solana flow, follow results as the match unfolds, build streaks, and climb the leaderboard.

This document summarizes the current product, architecture, user journey, and open decisions for CupRush 26. It reflects the repository state at draft time and cites the project files used as source material.

## Contents

1. [Introduction](#introduction)
2. [Overview](#overview)
3. [Core Features](#core-features)
4. [User Journey](#user-journey)
5. [Prediction Lifecycle](#prediction-lifecycle)
6. [Resolution and Scoring](#resolution-and-scoring)
7. [Technical Architecture](#technical-architecture)
8. [TxLINE Integration](#txline-integration)
9. [Trust, Safety, and Product Boundaries](#trust-safety-and-product-boundaries)
10. [Launch Scope and Future Plans](#launch-scope-and-future-plans)
11. [Disclaimer](#disclaimer)
12. [References](#references)

## Introduction

Football fans already predict the next goal, the final score, and the match hero in group chats, watch parties, and stadium seats. Most of those calls disappear the moment the match ends.

CupRush 26 gives those calls a place to live.

The product focuses on one simple loop: read a match question, make the call, lock the pick, watch the result, and see your rank move. It targets casual mobile fans who arrive through a shared link or QR code, understand football language, and do not want wallet jargon before they can join the fun. [R1]

CupRush 26 is entertainment, not betting. The app has no deposits, wagers, tradable positions, cash rewards, odds tables, or payout language. It rewards participation and correctness through database-only points, streaks, and leaderboard status. [R1]

## Overview

CupRush 26 is a mobile-first fan prediction layer for the 2026 international football tournament.

The app combines three ideas:

- **Instant participation:** Fans can browse open cards before authentication and understand the first decision within seconds. [R1][R5]
- **Live match tension:** Questions connect to fixture state and score events from TxLINE, so cards can move from open to locked, live, settling, and settled as the match progresses. [R2][R6]
- **Invisible proof infrastructure:** Solana records commitments and settlement state behind the experience, while the interface leads with football, not crypto. [R1][R3][R4]

The brand direction frames the product as a night-stadium, high-energy tournament experience: electric, triumphant, fiercely loyal, and visually original without copying official tournament assets. [R1][R8]

## Core Features

### Swipeable prediction deck

Fans answer cards with swipe as the primary mechanism. The card holds the fixture, question, and directional cues. The Yes/No or Higher/Lower fallback buttons sit outside the card in a stationary action rail, so touch and keyboard users can still answer without dragging. [R8][R9]

### Fast match and stat questions

The question system supports winner, goals, corners, yellow cards, red cards, exact-margin, and inter-fixture benchmark templates. Outcome formats use either Yes/No or Higher/Lower depending on the question. [R5][R7]

### Guest-first entry

Guests can view available questions before signing in. When a fan tries to save a pick, the app prompts them to sign in and creates a free account with an embedded wallet. [R5][R10]

### Batched pick commitment

After a fan answers the deck, the app submits the full answer batch. The server computes the canonical batch hash from inserted predictions, stores one batch per participant, and submits that single commitment to the chain adapter. Duplicate submissions return the existing immutable batch instead of changing picks. [R11][R12]

### Live fixture updates

The app consumes TxLINE replay data locally and live TxLINE data when configured. The ingestion pipeline validates raw payloads, applies fixture updates in sequence order, publishes updates to the in-process bus, and relays current fixture state to the web app through Server-Sent Events. [R2][R13]

### Settlement and scoring

When a fixture finishes, the settlement executor evaluates each settling question from fixture stats, settles it on Solana devnet, and scores confirmed predictions exactly once in the database. Correct picks add one point and advance the current streak; wrong picks reset the current streak; push outcomes mark predictions as scored without changing points. Points, streaks, and rank do not write to chain. [R6]

### Leaderboard

The public leaderboard ranks fans by points and best streak. It keeps the competitive layer simple: rank, fan name, points, current streak, and best streak. [R14][R8]

### Mobile PWA shell

The app ships as a Vite React client served by a Hono API process. It targets mobile-first interaction, stable bottom navigation, compact status indicators, and accessible fallbacks for swipe actions. [R2][R8]

## User Journey

### 1. Arrive from a shared link or QR code

The fan opens CupRush 26 during or before a match. The interface leads with a card, not a wallet screen. [R1]

### 2. Browse open questions

The deck loads open questions from the public questions API. Winner questions appear first so the first card feels obvious and high-stakes. [R5]

### 3. Make the call

The fan swipes the card or uses the outside action rail. Left maps to No or Lower. Right maps to Yes or Higher. [R8][R9]

### 4. Sign in only when saving matters

If the fan tries to keep a pick as a guest, the app asks them to sign in. Signing in creates a free account and embedded wallet so the pick can lock on Solana without requiring crypto knowledge. [R10]

### 5. Lock the deck

After the fan answers the available deck, the app submits the picks as one batch. The app stores the answers in Postgres, computes the batch hash server-side, and submits the commitment through the chain adapter. [R11][R12]

### 6. Watch the match

TxLINE updates move fixture and question state forward. Cards can show locked, live, settling, settled, void, delayed, or failed states in plain language. [R2][R6][R8]

### 7. See results and rank

The settlement executor evaluates results, scores confirmed predictions, updates streaks, and feeds the leaderboard. The fan sees proof of participation without needing to inspect chain details. [R6][R14]

## Prediction Lifecycle

CupRush 26 treats every prediction as part of a lifecycle instead of a one-off button press.

1. **Question generation:** The scheduler looks ahead to upcoming scheduled fixtures and generates questions from predefined templates. [R7][R15]
2. **Open window:** Questions open roughly six hours before kickoff. [R15]
3. **Lock window:** Questions lock thirty minutes before the earliest kickoff in a submitted batch. [R11][R15]
4. **Live state:** Fixture events move locked questions into live state when the match starts. [R15]
5. **Settling state:** Finished fixtures move live questions into settling state. [R15]
6. **Settlement:** The executor evaluates results from fixture stats, settles the question through the chain adapter, and writes scores once. [R6]
7. **Void state:** Postponed, cancelled, or abandoned fixtures move eligible questions to void. [R15]

The app uses conditional database updates and deterministic chain addresses to make retries safe. Repeated scheduler ticks, duplicate fixture events, and chain retry passes should not create duplicate questions, changed picks, or double scoring. [R6][R12][R15]

## Resolution and Scoring

CupRush 26 resolves outcomes from match stats rather than manual judging.

The evaluator reads a question rule, pulls the referenced stat values from the fixture stats object, applies the stored operator and comparison, and returns one of `yes`, `no`, `higher`, `lower`, `push`, or `not_ready`. Higher/Lower questions settle equal totals as push. [R16]

Only predictions from confirmed devnet batches receive scores. This keeps scoring aligned with committed picks while keeping points and status off chain. [R6]

Scoring currently uses a deliberately simple model:

- Correct pick: +1 point and +1 current streak.
- Incorrect pick: current streak resets to 0.
- Push: prediction becomes scored, but points and streak stay unchanged.

This model keeps the product readable for first-time fans. Sponsor-funded prizes may come later, but they depend on sponsor agreements and separate eligibility rules. The current product does not define prizes.

## Technical Architecture

CupRush 26 runs as one TypeScript package with a Vite React client, Hono API server, Drizzle/Postgres persistence layer, TxLINE ingestion, question scheduler, prediction reconciler, settlement executor, and shared chain adapter. [R2]

```text
TxLINE
  -> validated fixture and score events
  -> Postgres fixtures
  -> in-process live bus
  -> SSE /api/live
  -> React match cards

Fan picks
  -> React swipe deck
  -> /api/predictions/batch
  -> Postgres predictions + batch hash
  -> Solana chain adapter
  -> reconciler retry/repair loop

Finished fixtures
  -> settlement executor
  -> question evaluation
  -> chain settlement
  -> points, streaks, leaderboard
```

### Web client

The web client uses React and Vite. It includes deck, live, results, leaderboard, profile, authentication, save prompt, status badge, and transaction status components. [R9][R10][R14]

### API server

The API uses Hono. Routes expose questions, batched predictions, account actions, wallet registration, leaderboard data, health checks, and live Server-Sent Events. [R5][R11][R13][R14][R17]

### Database

Postgres stores participants, users, fixtures, questions, predictions, and prediction batches. Drizzle defines the schema and migrations. [R2][R18]

### Chain adapter

The chain layer exposes one interface with stub and Solana implementations. It can derive deterministic question and batch addresses, create questions, submit batch commitments, settle questions, and read existing chain state for retry repair. [R4][R19]

### Solana path

The Solana adapter targets devnet only for this PoC. It validates configuration fail-closed, connects lazily, creates and settles Anchor question accounts, and records batch commitments through deterministic batch addresses plus SPL Memo transactions. [R3][R19]

## TxLINE Integration

CupRush 26 uses TxLINE for football fixture and score data.

The integration supports:

- `POST /auth/guest/start` to mint a guest JWT.
- On-chain subscription and API token activation for live data access.
- `GET /api/fixtures/snapshot` for fixture lists.
- `GET /api/scores/snapshot/{fixtureId}` for fixture event history.
- `GET /api/scores/stream` for live score events over SSE. [R20]

The ingestion pipeline treats captured wire payloads as the practical contract. It validates every raw payload through Zod schemas before database writes, sorts snapshot events by `Seq`, ignores stale or duplicate events, and relies on cumulative score state so reconnects can heal missed events. [R20][R21]

Replay mode uses captured fixture files for local development and demos. Live mode uses TxLINE credentials and streams real updates for every 2026 fixture in scope. [R2][R20]

## Trust, Safety, and Product Boundaries

CupRush 26 keeps the experience approachable and avoids financial-product positioning.

### No betting mechanics

The product does not define deposits, wagers, odds, tradable positions, cash rewards, or payout mechanics. Copy should use “pick,” “prediction,” “points,” and “streak,” not “bet,” “stake,” “winnings,” or “jackpot.” [R1]

### Auth fails closed

Production auth uses Privy. If required Privy credentials are missing, the backend refuses to boot rather than falling back to unauthenticated access. The local development stub requires explicit opt-in and refuses production-like environments. [R2]

### Raw data validation

TxLINE wire payloads pass through schemas before they reach downstream code. Prediction batch requests and account updates also use strict Zod schemas at API boundaries. [R2][R11][R17][R20]

### User data boundaries

The backend does not store raw access tokens. Account deletion removes the user identity mapping and clears the display name, but retained participant, wallet, prediction, and on-chain data may remain because chain data cannot be erased. [R2][R17]

### Accessibility

The design system requires WCAG 2.1 AA contrast, 44px touch targets, visible focus, button alternatives for swipe actions, non-color state signals, and reduced-motion support. [R1][R8]

## Launch Scope and Future Plans

### Confirmed PoC scope

- **Rewards:** Points, streaks, and leaderboard status only. Reward state stays in the database and does not write to chain.
- **Prizes:** No prizes for the current PoC.
- **Chain environment:** Solana devnet only.
- **Match scope:** Every 2026 fixture.
- **Language:** English-first.
- **Distribution:** Start with X posts, Telegram community engagement, and QR codes.
- **License:** MIT.

### Future plans

- Sponsor-funded prizes may be added after sponsor agreements, eligibility rules, and campaign terms exist.
- Additional languages may be added after the English-first PoC proves the core loop.
- Distribution may expand beyond X, Telegram, and QR codes after early community feedback.

## Disclaimer

CupRush 26 is an independent hackathon proof of concept. It is not affiliated with, endorsed by, sponsored by, or officially connected to the FIFA World Cup 26, FIFA, or any tournament organizer. It is not an official video game or official tournament product.

## References

- [R1] [PRODUCT.md](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/PRODUCT.md) — product context, positioning, audience, non-betting boundary, voice, accessibility, and constraints.
- [R2] [README.md](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/README.md) — architecture, setup, TxLINE mode, auth, deployment, smoke test, and runtime model.
- [R3] [program/programs/world-cup-hilo/src/lib.rs](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/program/programs/world-cup-hilo/src/lib.rs) — Anchor program scope, question accounts, prediction accounts, settlement instruction, and on-chain constraints.
- [R4] [src/chain/adapter.ts](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/chain/adapter.ts) — shared chain adapter interface, question rules, batch commitments, and chain error taxonomy.
- [R5] [src/api/routes/questions.ts](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/api/routes/questions.ts) — public question listing, rendered copy, visible statuses, and winner-first ordering.
- [R6] [src/questions/settle.ts](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/questions/settle.ts) — settlement executor, scoring, retry handling, and exactly-once settlement writes.
- [R7] [src/questions/templates.ts](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/questions/templates.ts) — supported question templates and outcome labels.
- [R8] [DESIGN.md](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/DESIGN.md) — brand system, component rules, swipe deck behavior, motion language, accessibility, and visual boundaries.
- [R9] [src/web/components/card-deck.tsx](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/web/components/card-deck.tsx) — swipe deck implementation, guest gating, local answers, and action rail.
- [R10] [src/web/components/save-prompt.tsx](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/web/components/save-prompt.tsx) — sign-in prompt and embedded wallet explanation.
- [R11] [src/api/routes/predictions.ts](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/api/routes/predictions.ts) — batched prediction submission, validation, locking rule, rate limit, and idempotent duplicate behavior.
- [R12] [src/predictions/reconciler.ts](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/predictions/reconciler.ts) — pending batch retry, deterministic PDA repair, and question-on-chain creation.
- [R13] [src/api/routes/live.ts](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/api/routes/live.ts) — snapshot-first SSE live route and reconnect behavior.
- [R14] [src/api/routes/leaderboard.ts](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/api/routes/leaderboard.ts) — public leaderboard ranking by points and best streak.
- [R15] [src/questions/scheduler.ts](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/questions/scheduler.ts) — question generation horizon, open/lock transitions, fixture-driven states, and void handling.
- [R16] [src/questions/evaluate.ts](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/questions/evaluate.ts) — pure outcome evaluation, benchmark handling, and push rules.
- [R17] [src/api/routes/account.ts](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/api/routes/account.ts) — account, wallet, logout, deletion, and delegation revoke routes.
- [R18] [src/db/schema.ts](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/db/schema.ts) — database tables and enums for participants, fixtures, questions, predictions, and batches.
- [R19] [src/chain/solana.ts](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/src/chain/solana.ts) — Solana adapter, Anchor question handling, batch memo commitment, and configuration validation.
- [R20] [docs/txline-integration.md](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/docs/txline-integration.md) — TxLINE credential flow, endpoints, event model, and ingestion strategy.
- [R21] [docs/txline-feedback.md](/Users/rizal/GDrive/solana-world-cup-game/world-cup-game/docs/txline-feedback.md) — integration findings, captured traffic notes, and practical API behavior.
