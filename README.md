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
`src/txline/fixtures/samples`. Live mode (`TXLINE_MODE=live`) uses the
level-12 stream endpoints from the research doc
(`worldcup-hilo-hackathon-research.md`): `GET <TXLINE_BASE_URL>/snapshot`
for the fixture list on (re)connect, then `GET <TXLINE_BASE_URL>/stream`
as a newline-delimited JSON event stream, authenticated with
`TXLINE_API_KEY`. The exact wire shape is isolated in
`src/txline/live-client.ts`; everything downstream sees validated
`TxLineEvent` objects only.

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

## Environment

See `.env.example` for inline docs. Only the first three are required locally.

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | Postgres connection string |
| `PORT` | `3000` | Hono server port |
| `AUTH_MODE` | `dev` | `dev` stub tokens or `privy` verification |
| `TXLINE_MODE` | `replay` | `replay` captured fixtures or `live` stream |
| `TXLINE_BASE_URL` / `TXLINE_API_KEY` | — | Live TxLINE endpoints + auth (live mode only) |
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
const kickoff = new Date(Date.now() + 32.5 * 60_000);
const t = (m) => new Date(Date.now() + m * 60_000).toISOString();
const side = (g, c) => ({ goals: g, yellow_cards: 0, red_cards: 0, corners: c });
const stats = (hg, hc, ag, ac) => ({ full_time: { home: side(hg, hc), away: side(ag, ac) } });
const id = "smoke-" + Date.now();
require("fs").writeFileSync("/tmp/smoke-fixtures/smoke.json", JSON.stringify({
  snapshot: { fixture_id: id, home_team: "Smoke FC", away_team: "Test United",
    starts_at: kickoff.toISOString(), game_state: "scheduled", seq: 0, stats: stats(0,0,0,0) },
  events: [
    { fixture_id: id, seq: 1, type: "goal", game_state: "live", occurred_at: t(2), stats: stats(1,1,0,0) },
    { fixture_id: id, seq: 2, type: "corner", game_state: "live", occurred_at: t(4), stats: stats(1,2,0,1) },
    { fixture_id: id, seq: 3, type: "state_change", game_state: "finished", occurred_at: t(6), stats: stats(1,3,0,2) },
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
