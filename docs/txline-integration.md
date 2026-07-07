# TxLINE integration — technical documentation

CupRush 26 consumes live soccer data from the TxLINE API. This document names
every endpoint we use, the credential flow that unlocks them, the event model
on the wire, and how our ingestion pipeline consumes it. We run against the
TxLINE **devnet** environment:

```
Base origin:  https://txline-dev.txodds.com
Auth calls:   https://txline-dev.txodds.com/auth/...
Data calls:   https://txline-dev.txodds.com/api/...
Solana RPC:   https://api.devnet.solana.com
```

Note the base-path split: authentication lives under `/auth`, everything else
under `/api`. All shapes below come from real captured devnet traffic
(`src/txline/fixtures/captured/`), not from documentation alone.

## Credential flow

Getting a working API token takes four steps: mint a guest JWT, subscribe
on-chain, activate the token with a wallet signature, then send both
credentials on every data call. The whole flow is scripted in
`scripts/txline-activate.ts`.

### 1. Mint a guest JWT

```
POST /auth/guest/start
```

No auth, no body. Returns `{"token": "<jwt>"}`. The JWT is valid for 30 days;
we re-mint it on any 401 rather than tracking expiry.

### 2. Subscribe on-chain

Send a `subscribe` instruction to the TxLINE program on Solana devnet
(`6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`). Payment is in TxL, a
Token-2022 mint (`4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG`). We subscribe
at service level 1 (World Cup + International Friendlies, 60-second delay) for
4 weeks:

- Instruction data: 8-byte discriminator + `service_level_id: u16 LE` +
  `weeks: u8` (weeks must be a multiple of 4).
- Accounts: user (writable, signer), `pricing_matrix` PDA, TxL mint, user's
  TxL ATA (writable), treasury vault ATA (writable), `token_treasury_v2` PDA,
  Token-2022 program, System program, Associated Token program.

Re-running is safe: a second subscribe extends validity by another period.

### 3. Activate the API token

Sign the activation message with the same wallet that subscribed
(ed25519 detached signature, base64-encoded):

```
${txSig}:${leagues.join(",")}:${jwt}
```

With no extra leagues the message contains a double colon: `${txSig}::${jwt}`.
Then:

```
POST /api/token/activate
Authorization: Bearer <jwt>

{"txSig": "...", "walletSignature": "<base64>", "leagues": []}
```

Returns the API token (`txoracle_api_…`) as plain text. The server validates
`txSig` on-chain and can lag right after confirmation, so we retry with
backoff (2s, 4s, 8s, up to 5 attempts).

### 4. Authenticate data calls

Every data call carries **both** headers:

```
Authorization: Bearer <guest jwt>
X-Api-Token: <txoracle_api_…>
```

Our client (`src/txline/live-client.ts`) mints the JWT lazily, and on a 401
re-mints once and retries once; a second 401 is a hard error.

## Data endpoints

### GET /api/fixtures/snapshot

The fixture list for the active subscription. Returns a JSON array; each
entry (trimmed to the fields we consume):

```json
{
  "FixtureId": 18192996,
  "StartTime": 1783299600000,
  "Competition": "World Cup",
  "CompetitionId": 72,
  "Participant1Id": 2545,
  "Participant1": "Mexico",
  "Participant2Id": 1888,
  "Participant2": "England",
  "Participant1IsHome": true,
  "GameState": 3
}
```

All timestamps are epoch milliseconds. `Participant1` is not necessarily the
home team — `Participant1IsHome` decides the mapping. The numeric `GameState`
here is undocumented and sometimes absent; we ignore it (see event model
below).

### GET /api/scores/snapshot/{fixtureId}

The full event history for one fixture, as a JSON array of score events (same
shape as the stream, below). The array arrives **unordered** — we sort by
`Seq` ascending before applying. A finished demo fixture
(`scores-snapshot-18192996.json`, Mexico–England) carries 1000+ events across
all 44 action types.

### GET /api/scores/stream (SSE)

Live events as `text/event-stream` (request with `Accept:
text/event-stream`). Two frame types:

```
data: {"FixtureId":18193785,"GameState":"scheduled","Action":"comment","Id":1,"Ts":1782958462911,"Seq":1, ...}
event: scores
id: 1

data: {"Ts":1783348591}
event: heartbeat
```

Heartbeats arrive every ~15 seconds; their `Ts` is epoch **seconds**, unlike
event `Ts` which is epoch **milliseconds** — we drop heartbeat frames before
they reach the event schema. The SSE `id` field mirrors the event's `Id`,
which is not unique, so we do not rely on `Last-Event-ID` resume; we heal
gaps with snapshots instead (see ingestion below).

## Event model

One score event (a goal from the captured Mexico–England fixture, trimmed):

```json
{
  "FixtureId": 18192996,
  "GameState": "scheduled",
  "Action": "goal",
  "Id": 352,
  "Seq": 384,
  "Ts": 1783302183381,
  "StatusId": 2,
  "Participant1IsHome": true,
  "Clock": { "Running": true, "Seconds": 2508 },
  "Score": {
    "Participant1": { "H1": { "Goals": 1, "Corners": 2 }, "Total": { "Goals": 1, "Corners": 2 } },
    "Participant2": { "H1": { "Goals": 2, "YellowCards": 1, "Corners": 2 }, "Total": { "Goals": 2, "YellowCards": 1, "Corners": 2 } }
  },
  "Data": { "GoalType": "Shot", "PlayerId": 658987 }
}
```

Facts the integration relies on, all verified against captured traffic:

- **`Seq` is the only ordering key.** Per fixture, strictly increasing, with
  gaps (e.g. 0 → 3 → 5 → 8). Events arrive unordered in snapshots. `Id` is
  not unique — never use it for ordering or dedup.
- **`Action` has a 44-value vocabulary** on the demo fixture: score-bearing
  actions (`goal`, `yellow_card`, `red_card`, `corner`, `game_finalised`,
  `halftime_finalised`, `score_adjustment`, `penalty_outcome`, …) plus
  informational ones (`comment`, `shot`, `possession`, `lineups`, `weather`,
  `var`, `substitution`, `kickoff`, …). We advance fixture state only on
  events that carry a `Score` object.
- **`Score` is cumulative and sparse.** Each event carries the fixture's full
  running totals, not a delta; a missing period or stat key means 0. Period
  keys are `H1`, `HT` (score at the half-time whistle), `H2`, and `Total`.
  We map `H1`/`H2`/`Total` and skip `HT`.
- **The event-level `GameState` string is stale.** It reads `"scheduled"`
  even on `game_finalised` events. `StatusId` is the live signal (2 while in
  play, 100 on `game_finalised`). We derive state from `Action` instead:
  `game_finalised` → finished, any other Score-bearing action → live.
- **`Participant1IsHome`** decides home/away for both names and scores.

## How our ingestion consumes it

`src/txline/live-client.ts` + `src/txline/schema.ts` implement
snapshot-then-stream:

1. **Seed** — `GET /api/fixtures/snapshot` upserts fixtures, then
   `GET /api/scores/snapshot/{fixtureId}` replays each fixture's history:
   parse, sort by `Seq`, keep Score-bearing events, apply in order.
2. **Stream** — `GET /api/scores/stream` feeds the same
   validate → apply → publish pipeline. Reconnects re-run the snapshots
   first, so any event missed while disconnected is healed by the cumulative
   snapshot before the stream resumes.
3. **Seq guard** — `applyTxLineEvent` (`src/txline/apply.ts`) compares
   `event.seq` to the fixture's stored `last_seq` and drops stale or
   duplicate events, so replays and reconnects are idempotent. Because every
   `Score` is the full cumulative state, applying an event is always
   "replace with newer state" — gaps in `Seq` lose nothing.
4. **Validation boundary** — every raw payload passes through Zod schemas in
   `src/txline/schema.ts` before touching the database. Invalid events are
   logged and discarded. The PascalCase wire shape exists only in that file;
   everything downstream sees normalized `TxLineEvent` objects.
