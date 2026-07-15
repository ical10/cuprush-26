# Railway Automatic Match Runner

## Goal

Keep the CupRush web service permanently in `APP_RUNTIME_MODE=web` and automatically run match-processing infrastructure only when a match is near or active. No manual runtime-mode changes should be required.

## Constraints

- Railway cron schedules have a five-minute minimum interval and skip overlapping executions.
- The runner must exit quickly when no match needs processing so idle compute stays near zero.
- Match state must survive runner restarts and missed in-memory events.
- The web service and runner are separate processes, so live browser updates cannot rely only on an in-process event emitter.
- Do not add Redis, a new external dependency, or a database migration.
- Production currently uses `TXLINE_MODE=replay` and has no reviewed live TxLINE or chain credentials. Deployment can verify lifecycle behavior safely, but real-match operation remains blocked until those credentials are configured and manually reviewed.
- Production currently uses `AUTH_MODE=dev` and `NODE_ENV=development`. This plan does not change authentication or its configuration.

## Design

### Bounded runner

Add a `match-runner` entry point that:

1. Opens a dedicated PostgreSQL connection and takes a fixed session advisory lock. If another runner holds it, exit successfully.
2. Starts the question scheduler subscription before TxLINE.
3. Fetches only the TxLINE fixture list, refreshing team/start metadata without changing durable sequence, stats, or game state.
4. Runs fixture/question catch-up and one reconciliation/settlement pass when chain writes are explicitly enabled.
5. Decides whether match processing is active before fetching any per-fixture score snapshots.
6. When active, fetches score snapshots, opens the live stream, and immediately runs durable catch-up again before settlement.
7. Remains alive while any of these conditions is true:
   - a scheduled fixture starts within 40 minutes or started within the last four hours (missed-kickoff recovery);
   - a live fixture started within the last four hours;
   - a question is live;
   - a question is settling and chain writes are enabled.
8. While active, repeats processing once per minute.
9. Exits after two consecutive idle checks. A hard six-hour bound forces a clean handoff to the next cron invocation.
10. Handles `SIGINT`/`SIGTERM`, aborts in-flight discovery/snapshot/stream requests, and always stops timers and TxLINE, releases the advisory lock/connection, and closes the pool.

Chain reconciliation and settlement fail closed. `MATCH_RUNNER_CHAIN_WRITES`
defaults to disabled. Enabling it requires both the explicit value `enabled`
and `CHAIN_MODE=solana`; the runner never uses the process-local stub for
chain writes.

Railway runs the service every five minutes. The web service remains serverless and never changes runtime mode.

### Durable state recovery

Each scheduler tick derives required question transitions from current fixture state and timestamps, in addition to responding to local TxLINE bus events. This makes `locked → live`, `live → settling`, and void transitions recoverable after a runner crash or missed event.

### TxLINE readiness

Split TxLINE startup into fixture-only `prepare()` and full `start()`. Preparation is safe for every idle cron invocation. Full start resolves only after score snapshots have been applied and the live stream has connected. Initial synchronization failures reject. Stream EOF/errors trigger bounded backoff, fixture/score re-snapshot, and reconnect; exhausting retries surfaces a terminal failure so the runner exits nonzero and Railway restarts it.

### Cross-process live updates

Extend the TxLINE bus with a PostgreSQL `LISTEN`/`NOTIFY` bridge:

- Runner updates publish to its local bus and send a PostgreSQL notification.
- The web process creates one shared listener only while at least one SSE client is connected.
- Notification payloads are schema-validated before entering the local event emitter.
- The listener is removed and its connection closed after the final SSE client disconnects, allowing the web service to sleep.
- If the listener reconnects, existing SSE streams close so browsers reconnect and receive the existing snapshot-first recovery path.

The database remains the source of truth; notifications are only a low-latency hint, so no event-log table is required.

## Files

Create:

- `src/runner/match-runner.ts`
- `src/runner/match-runner.test.ts`
- `src/runner/match-runner.int.test.ts`
- `src/txline/postgres-bus.ts`
- `src/txline/postgres-bus.test.ts`
- `railway.runner.json`

Modify:

- `src/txline/client.ts`
- `src/txline/live-client.ts`
- `src/txline/live-client.test.ts`
- `src/txline/replay-client.ts`
- `src/txline/bus.ts`
- `src/questions/scheduler.ts`
- `src/questions/scheduler.test.ts`
- `src/questions/scheduler.int.test.ts`
- `src/api/routes/live.ts`
- `src/api/live.int.test.ts`
- `src/api/app.ts`
- `package.json`
- `.env.example`
- `README.md`

The exact file split may be simplified during implementation if behavior, validation, tests, and cleanup guarantees remain unchanged.

## Tests and validation

- Runner activation window, two-idle exit, six-hour bound, in-flight signal abort, fail-closed chain configuration, and advisory-lock contention.
- Integration coverage proving two runners cannot overlap and locks/connections are released.
- Scheduler catch-up for missed fixture events and terminal/void states.
- Fixture-only idle discovery, TxLINE startup readiness, initial-sync failure propagation, stream reconnect/re-snapshot, and terminal failure propagation.
- Cross-process notification delivery to SSE, malformed payload rejection, reconnect/snapshot recovery, and listener cleanup after the last client disconnects.
- Lint, typecheck/build, full unit tests, web tests, and integration tests.

## Railway rollout

Create a production `match-runner` service from `main` with:

- Config file: `/railway.runner.json`
- Start command: `pnpm match-runner`
- Cron: `*/5 * * * *`
- Region: Singapore
- No public domain or health check
- Restart policy: `ON_FAILURE`, maximum two retries
- Variables referenced from the existing production service: database, TxLINE, and optional LLM settings
- Explicit `MATCH_RUNNER_CHAIN_WRITES=disabled`; do not provide chain-write credentials until reviewed

Keep the existing web service on `railway.json`, Serverless enabled, and `APP_RUNTIME_MODE=web`.

## Rollout gates

1. Merge only after the full test suite and security-focused review pass.
2. Deploy the runner in current replay mode and verify an idle invocation completes quickly without waking the web service permanently.
3. Verify the active lifecycle locally/in integration tests; do not inject fake production match data.
4. Before enabling real matches, manually review and configure `TXLINE_MODE=live` and valid TxLINE credentials.
5. Enable settlement only after a separate chain review by setting `MATCH_RUNNER_CHAIN_WRITES=enabled`, `CHAIN_MODE=solana`, and valid Solana credentials together.
6. Separately remediate production dev authentication before exposing user data or accepting real users.
