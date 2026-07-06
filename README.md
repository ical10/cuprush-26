# World Cup Hi-Lo

Mobile-first fan game: predict match and stat outcomes, save the pick through
Solana, watch the card react to live TxLINE events, climb the leaderboard.
See `plans/PRD.md` for the full product spec.

## Architecture

One TypeScript package, ESM, Node 22, pnpm. A single Hono process runs the
REST API, the SSE live stream, TxLINE ingestion, and three one-minute
background loops (question scheduler, prediction reconciler, settlement
executor) — all wired in `src/api/server.ts` with graceful shutdown on
SIGINT/SIGTERM. Chain access goes through one shared adapter (in-memory stub
by default, `CHAIN_MODE=solana` for the real thing).

Data flow: TxLINE events → `src/txline` (sequence-guarded apply into
`fixtures` + in-process bus) → the bus fans out to the SSE `/api/live` route
and the question scheduler (`live → settling → void` transitions) → the
settlement executor evaluates settling questions from fixture stats, settles
on chain, and scores predictions exactly once.

```
src/web         Vite + React + vite-plugin-pwa client
src/api         Hono server, routes, auth adapters (dev stub / Privy)
src/db          Drizzle schema, migrations, Postgres client
src/txline      TxLINE ingestion: replay + live clients, event apply, bus
src/questions   Question templates, generation, scheduler, settlement
src/predictions Prediction reconciler (retry/repair pending chain submits)
src/chain       Chain adapter interface, in-memory stub, Solana adapter
program/        Anchor program source (Rust)
```

Vite dev server proxies `/api` to the Hono server. Whenever `dist/client`
exists (after `pnpm build`), the Hono server also serves the built client.

### TxLINE endpoints

Replay mode (default) streams the captured JSON files in
`src/txline/fixtures/samples`. Live mode (`TXLINE_MODE=live`) talks to the
real TxLINE API at `TXLINE_BASE_URL` (the origin, no `/api` suffix): it
mints a guest JWT via `POST /auth/guest/start`, then — sending
`Authorization: Bearer <jwt>` plus `X-Api-Token: <TXLINE_API_KEY>` on every
data call — fetches `GET /api/fixtures/snapshot` for the fixture list,
`GET /api/scores/snapshot/{fixtureId}` for each fixture's event history,
and follows `GET /api/scores/stream` (SSE) for live events. A 401 re-mints
the JWT once and retries. The exact wire shape is isolated in
`src/txline/schema.ts` + `src/txline/live-client.ts`; everything downstream
sees validated `TxLineEvent` objects only.

## Setup

Requires Node 22, pnpm, and a local Postgres 18 (no Docker; this repo targets
the default Homebrew socket).

```sh
pnpm install
createdb worldcup_hilo
cp .env.example .env   # adjust DATABASE_URL if your Postgres setup differs
pnpm db:migrate
pnpm seed:demo   # optional: one open winner + inter-fixture card to swipe
pnpm dev
```

The app runs at http://localhost:5173 (Vite) with the API on
http://localhost:3000 (see `PORT` in `.env`).

Without `pnpm seed:demo` (or live TxLINE data) the deck shows the "no open
questions" empty state. The seed inserts a finished benchmark fixture and one
fixture kicking off in ~2 hours, leaving a winner card and an inter-fixture
corner card open to answer immediately. It is idempotent and local-only.

## Environment

See `.env.example` for inline docs. Only the first three are required locally.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | Postgres connection string |
| `PORT` | `3000` | Hono server port |
| `AUTH_MODE` | `dev` | `dev` stub tokens or `privy` verification |
| `TXLINE_MODE` | `replay` | `replay` captured fixtures or `live` stream |
| `TXLINE_BASE_URL` / `TXLINE_API_KEY` | — | TxLINE origin (no `/api` suffix) + X-Api-Token key (live mode only; guest JWT self-minted) |
| `TXLINE_REPLAY_INTERVAL_MS` | `1500` | ms between replayed events (0 = all at once) |
| `TXLINE_FIXTURES_DIR` | `src/txline/fixtures/samples` | Alternate replay fixtures directory |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | — | Privy credentials (`AUTH_MODE=privy` only) |
| `CHAIN_MODE` | stub | `solana` selects the real chain adapter |
| `SOLANA_RPC_URL` / `HILO_PROGRAM_ID` | — | Solana adapter config (`CHAIN_MODE=solana` only) |
| `LLM_SELECTOR` / `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | off | Optional LLM question selector (background only) |

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
| `pnpm seed:demo` | Insert local demo fixtures + open cards (idempotent) |

## Testing

Vitest is split into three projects:

- **unit** — `*.test.ts` outside `src/web`, no external dependencies.
- **web** — `src/web/**/*.test.{ts,tsx}` component tests under jsdom
  (`pnpm exec vitest run --project web`).
- **integration** — `*.int.test.ts`, requires Postgres at `DATABASE_URL`.
  The global setup drops and recreates a dedicated `worldcup_hilo_test`
  database and migrates it once per run. All integration files share that
  database, so they run serially (`fileParallelism: false`) and every test
  scopes its assertions to its own randomly-suffixed fixture IDs.

## Smoke test

End-to-end pass against a production-ish server (built client, dev auth
stub, replay TxLINE, stub chain). Takes ~8 minutes of wall time — the
scheduler ticks once a minute and the replayed match plays out in real time.

```sh
pnpm build
createdb worldcup_hilo 2>/dev/null; pnpm db:migrate

# 1. Generate a replay fixture kicking off 32.5 minutes from now:
#    questions open immediately, lock in ~2.5 min, the match goes live and
#    finishes over the following minutes.
mkdir -p /tmp/smoke-fixtures
node -e '
const kickoff = Date.now() + 32.5 * 60_000;
const t = (m) => Date.now() + m * 60_000;
const score = (hg, hc, ag, ac) => ({
  Participant1: { Total: { Goals: hg, Corners: hc } },
  Participant2: { Total: { Goals: ag, Corners: ac } },
});
const id = Date.now();
const event = (Seq, Action, m, ...s) =>
  ({ FixtureId: id, Seq, Ts: t(m), Action, Participant1IsHome: true, Score: score(...s) });
require("fs").writeFileSync("/tmp/smoke-fixtures/smoke.json", JSON.stringify({
  snapshot: { FixtureId: id, StartTime: kickoff, Participant1: "Smoke FC",
    Participant2: "Test United", Participant1IsHome: true },
  events: [
    event(1, "goal", 2, 1, 1, 0, 0),
    event(2, "corner", 4, 1, 2, 0, 1),
    event(3, "game_finalised", 6, 1, 3, 0, 2),
  ],
}, null, 2));'

# 2. Start the server (dev auth mode refuses NODE_ENV=production; the built
#    client is served whenever dist/client exists).
TXLINE_FIXTURES_DIR=/tmp/smoke-fixtures TXLINE_REPLAY_INTERVAL_MS=120000 \
  pnpm exec tsx --env-file=.env src/api/server.ts

# 3. In another shell — create a dev user, set its wallet:
curl -s localhost:3000/api/me -H "Authorization: Bearer dev:smoke"
curl -s -X POST localhost:3000/api/wallet -H "Authorization: Bearer dev:smoke" \
  -H "content-type: application/json" \
  -d '{"address":"7VfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"}'

# 4. Once the next scheduler tick generates questions (<= 60s), pick the
#    open "winner" question and predict home win ("yes"):
curl -s localhost:3000/api/questions
QID=<id of the open winner question>
curl -s -X POST localhost:3000/api/predictions -H "Authorization: Bearer dev:smoke" \
  -H "content-type: application/json" -d "{\"questionId\":\"$QID\",\"outcome\":\"yes\"}"
# expect: {"chainStatus":"confirmed", ...}

# 5. Wait for the replay to finish the match (~6 min after boot), then:
curl -s localhost:3000/api/questions      # winner question "status":"settled","result":"yes"
curl -s localhost:3000/api/me -H "Authorization: Bearer dev:smoke"   # points: 1, currentStreak: 1
curl -s localhost:3000/api/leaderboard    # the dev user on top with 1 point
```

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
