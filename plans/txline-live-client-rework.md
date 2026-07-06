# Plan: TxLINE live client rework (real API shape)

## Goal
Make `TXLINE_MODE=live` actually work against the real TxLINE API using the
devnet credentials now in `.env`. Replace the best-guess wire code (single
Bearer header, `/snapshot` + `/stream` newline-JSON) with the verified real
contract (guest-JWT + X-Api-Token headers, SSE, real endpoint paths).

## Verified real contract (docs + OpenAPI + working activation script)
- `TXLINE_BASE_URL` = origin (e.g. `https://txline-dev.txodds.com`)
  - `POST {origin}/auth/guest/start` → `{token}` guest JWT, 30-day expiry,
    unauthenticated — the server mints its own
  - `GET {origin}/api/fixtures/snapshot` → array of
    `{FixtureId, Participant1, Participant2, Participant1IsHome, StartTime}`
  - `GET {origin}/api/scores/snapshot/{fixtureId}` — per-fixture score state
  - `GET {origin}/api/scores/stream` — **SSE** (`Accept: text/event-stream`)
- Every data call: `Authorization: Bearer <jwt>` + `X-Api-Token: <apiKey>`
- On 401: reacquire JWT once, retry; API token stays valid (subscription-bound)

## Env contract (two vars, same names as today)
- `TXLINE_BASE_URL` — origin only (client appends paths). `.env` currently
  holds `…/api`-less? — verify + fix during implementation.
- `TXLINE_API_KEY` — the durable `txoracle_api_…` X-Api-Token
- **Remove `TXLINE_JWT` from `.env`/`.env.example`** — runtime self-mints.

## Phase 0 — probe (subagent, read-only, creds from .env)
Real payload shapes for scores snapshot/stream are still undocumented in this
repo (`schema.ts` header says "adjust once a real payload is captured" —
that's now). Curl all three data endpoints with the devnet creds, capture raw
JSON/SSE frames into `src/txline/fixtures/captured/` (gitignore-check: these
are public sports data, safe to commit), and report the exact field names,
seq/ordering field, and game-state vocabulary.

## Phase 1 — implement (subagent, TDD per repo bar)
1. `src/txline/schema.ts` — adjust raw z.object shapes to the captured
   reality; **keep the transformed output types stable** (module was designed
   as the single adjust-point; downstream `apply.ts`/`bus.ts` untouched).
2. `src/txline/live-client.ts` rework:
   - `readLiveConfig`: `TXLINE_BASE_URL` (origin) + `TXLINE_API_KEY`
   - JWT manager: mint on start, reacquire-once-on-401 helper wrapping fetch
   - snapshot: `GET /api/fixtures/snapshot` (+ per-fixture scores snapshot if
     the probe shows stats live there), map to fixture upsert
   - stream: SSE parser (`text/event-stream`: `event:`/`data:` lines, blank-
     line delimited; handle multi-line data + keepalive comments) feeding the
     existing validate→apply→publish pipeline
   - reconnect: existing behavior (snapshot before resume) preserved
3. Tests (vitest unit, mock fetch/ReadableStream):
   - SSE parser: frame splitting, multi-line data, comment/keepalive skip
   - 401 → one JWT reacquire → retry → success; second 401 → error out
   - both headers present on every data request
   - snapshot mapping from a captured real payload
4. `.env` / `.env.example` / README env table: base-url semantics + drop
   `TXLINE_JWT`.

## Phase 2 — verify (orchestrator)
- `pnpm test`, `pnpm test:integration`, `pnpm typecheck`, `pnpm lint` green
- Manual: `TXLINE_MODE=live pnpm dev` against devnet — fixtures appear in DB,
  SSE events flow (devnet may be quiet; snapshot ingest alone proves auth+
  shape; note what was/wasn't observable)

## Boundaries
- Downstream contract frozen: `TxLineEvent`/`FixtureUpdate` output shapes,
  `apply.ts`, `bus.ts`, SSE relay to browsers — untouched.
- Replay mode untouched (demo path must keep working without creds).
- Never log or commit credentials; captured fixture files must contain no
  tokens (strip headers, body only).
- If the probe reveals the scores stream needs per-fixture subscriptions or
  an undocumented shape that breaks the seq guard, STOP and report before
  improvising.

## Out of scope
- Mainnet level-12 activation (separate; same script with --mainnet later)
- TxOracle settlement (`validateStat`, anchor adoption — separate plan)
