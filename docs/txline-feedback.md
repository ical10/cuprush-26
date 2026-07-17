# TxLINE API — developer feedback

Candid notes from integrating TxLINE devnet into CupRush 26. We built the
full path: guest JWT, on-chain subscription, token activation, fixtures and
scores snapshots, and the live SSE stream. Everything below comes from that
work — captured payloads live in `src/txline/fixtures/captured/`, and the
integration itself is documented in `docs/txline-integration.md`.

## What worked well

- **The free devnet tier is the right on-ramp.** Service level 1 on devnet
  costs nothing real: a throwaway keypair, a faucet airdrop, and one
  transaction. We proved the whole credential pipeline before committing to
  anything.
- **Credentialing is fully scriptable.** Guest JWT, subscribe instruction,
  activation signature, smoke test — one script end to end with no manual
  console steps (`scripts/txline-activate.ts`). The published IDL made the
  hand-rolled `subscribe` instruction straightforward. Re-runs are safe:
  subscribing again extends validity, and activation just re-issues a token.
- **SSE was the right transport choice.** Plain `text/event-stream` over
  HTTPS works with `fetch` and a small parser — no WebSocket handshake, no
  client library. Regular ~15-second heartbeats make dead connections easy
  to detect.
- **The curated demo fixture is genuinely useful.** The finished
  Mexico–England fixture (18192996) carries 1000+ events covering all 44
  action types, including the rare ones (`var`, `score_adjustment`,
  `penalty_outcome`, `unreliable_corners`). We could test our full pipeline
  against realistic data without waiting for a live match.
- **Cumulative scores are a robust design.** Because every Score-bearing
  event carries the fixture's full running totals, a consumer that misses
  events loses nothing — the next event or snapshot heals it. This made our
  reconnect logic simple.

## Friction we hit

Most of our integration time went into discovering that the wire diverges
from the documentation, then re-verifying every field against captured
traffic.

- **The documented event shape is not what the API returns.** The docs
  describe snake_case fields and ISO timestamps; the wire is PascalCase with
  epoch-millisecond timestamps. The docs also suggest a single state object
  per fixture, but both the scores snapshot and the stream return event
  arrays. We ended up treating the captures, not the docs, as the contract.
- **`GameState` on events is stale.** It reads `"scheduled"` even on the
  `game_finalised` event of a finished match. `StatusId` (2 in play, 100 on
  final) is the real signal, but it is undocumented — we found it by
  diffing captures. The fixtures snapshot adds a different, numeric
  `GameState` that is sometimes absent, which compounds the confusion.
- **Snapshot events arrive unordered, and nothing says so.** Our first pass
  assumed array order and produced wrong intermediate scores. `Seq` is the
  ordering key (per fixture, increasing, with gaps), but the sort contract
  is nowhere in the docs.
- **`Id` is not unique.** It looks like an event ID and it is also the SSE
  `id:` field, which implies `Last-Event-ID` resume — but duplicate values
  in the same fixture history make both uses unsafe. `Seq` is what `Id`
  appears to be.
- **Heartbeat `Ts` is epoch seconds; event `Ts` is epoch milliseconds.**
  Same field name, same stream, different unit. Until we special-cased
  heartbeats, they failed timestamp validation as dates in 1970.
- **The `/auth` vs `/api` base-path split is easy to miss.**
  `POST /auth/guest/start` lives at the origin while everything else is
  under `/api`. Configuring one base URL naively breaks one side or the
  other; we added a guard that strips a trailing `/api` from configuration
  just for this.
- **The OpenAPI spec lists devnet as `http://`.** The server speaks HTTPS
  fine. A generated client that trusts the spec starts insecure by default.
- **Activation races on-chain confirmation.** `POST /api/token/activate`
  can reject a just-confirmed `txSig` because the server has not seen the
  transaction yet. Retry-with-backoff fixed it, but the error does not say
  "try again shortly", so it initially looked like a signature bug.

## Suggestions

1. **Publish the real event schema.** One JSON Schema (or an accurate
   OpenAPI component) for the score event — PascalCase field names,
   epoch-ms timestamps, the sparse cumulative `Score` object with
   `H1`/`HT`/`H2`/`Total`, and the full `Action` vocabulary. This alone
   would have saved us the most time.
2. **Fix `GameState` or document `StatusId`.** Either make the event-level
   `GameState` reflect reality, or document `StatusId` values as the
   canonical state signal and mark `GameState` deprecated.
3. **Document the ordering contract.** State plainly: snapshot arrays are
   unordered; sort by `Seq`; `Seq` has gaps; `Id` is not unique. Four
   sentences that every consumer needs.
4. **Ship one worked end-to-end example.** A single walkthrough from
   `POST /auth/guest/start`, through subscribe and activate, to the first
   SSE event with real request and response bodies. Each step is documented
   somewhere; the connected path is what integrators actually follow, and
   assembling it ourselves is where most of the friction above surfaced.

Smaller items: note the heartbeat `Ts` unit next to the event `Ts`, list
`https://` for devnet in the OpenAPI spec, and have `/api/token/activate`
return a retryable status (or a hint) while the transaction is still
propagating.

None of this blocked us — the API is stable, the data is rich, and once the
real wire shape is pinned down the integration is small. Accurate schema
docs would turn a days-long discovery exercise into an afternoon.
