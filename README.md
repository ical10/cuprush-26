# World Cup Hi-Lo

Mobile-first fan game: predict match and stat outcomes, save the pick through
Solana, watch the card react to live TxLINE events, climb the leaderboard.
See `plans/PRD.md` for the full product spec.

## Stack

One TypeScript package, ESM, Node 22, pnpm.

- `src/web` — Vite + React + `vite-plugin-pwa`
- `src/api` — Hono on `@hono/node-server` (REST, SSE, ingestion, scheduler, settlement)
- `src/db` — Drizzle schema, migrations, and queries against Postgres

Vite dev server proxies `/api` to the Hono server. In production, Hono serves
the built client from `dist/client` alongside the API.

## Setup

Requires Node 22, pnpm, and a local Postgres 18 (no Docker; this repo targets
the default Homebrew socket).

```sh
pnpm install
createdb worldcup_hilo
cp .env.example .env   # adjust DATABASE_URL if your Postgres setup differs
pnpm db:migrate
pnpm dev
```

The app runs at http://localhost:5173 (Vite) with the API on
http://localhost:3000 (see `PORT` in `.env`).

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Run Vite client + Hono API together (watch mode) |
| `pnpm build` | Build the production client bundle into `dist/client` |
| `pnpm start` | Run the production server (serves built client + API) |
| `pnpm test` | Run unit tests (`*.test.ts`) |
| `pnpm test:integration` | Run integration tests (`*.int.test.ts`) against Postgres |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm db:generate` | Generate Drizzle migrations from `src/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |

## Testing

Vitest is split into two projects:

- **unit** — anywhere matching `*.test.ts`, no external dependencies.
- **integration** — anywhere matching `*.int.test.ts`, requires a reachable
  Postgres database at `DATABASE_URL`. The database-schema integration suite
  additionally drops and recreates a dedicated `worldcup_hilo_test` database
  and applies migrations to it before each run.

## Auth

`AUTH_MODE` selects the auth adapter (`src/api/auth`):

- `dev` (default) — local stub. Any `Authorization: Bearer dev:<id>` header
  authenticates as the fake Privy user `<id>`. Logs a loud warning on start
  and refuses to run when `NODE_ENV=production`.
- `privy` — verifies real Privy access tokens via `@privy-io/server-auth`;
  requires `PRIVY_APP_ID` and `PRIVY_APP_SECRET`.

The first authenticated request provisions a `participants` row
(kind=human) plus a `users` row mapping the Privy user id, in one
transaction. No OTPs, emails, or raw tokens are stored.

Semantics worth knowing:

- `POST /api/logout` returns 204 and stores nothing — the backend is
  stateless, so logout means the client clearing its Privy session.
- `POST /api/wallet/delegation/revoke` records the revocation in
  `participants.delegation_revoked_at`; the Privy-side revocation itself is
  HITL until Privy credentials land.
- `DELETE /api/me` anonymizes: deletes the `users` row and clears the
  display name, but keeps the participant, wallet link, and predictions.
  On-chain data cannot be erased — the client must disclose this first.

## Environment

See `.env.example` for the full list. Nothing beyond `DATABASE_URL`, `PORT`,
and `AUTH_MODE=dev` is required to run the app locally. TxLINE, Privy, and
OpenRouter integrations are env-gated and unused until credentials land.
