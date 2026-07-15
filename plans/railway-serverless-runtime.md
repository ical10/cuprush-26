# Plan: Railway Serverless runtime optimization

## Goal

Let the Railway HTTP app sleep when CupRush is idle without weakening
production authentication or deleting the background gameplay behavior.

## Current blockers

- The integration CI job creates the app without `AUTH_MODE`, so fail-closed
  Privy initialization rejects the missing `PRIVY_APP_ID`.
- `src/api/server.ts` starts TxLINE ingestion, the question scheduler, the
  prediction reconciler, and the settlement executor in the HTTP process.
  Their recurring database and network activity prevents Railway Serverless
  from observing ten outbound-idle minutes.
- A database-backed request can leave a pooled Postgres connection open after
  the response, preventing the web process from becoming outbound-idle.
- Production tracks `main`; `staging` has substantial unmerged product work.
  This change must not merge or overwrite that branch implicitly.

## Design

Add an environment-controlled runtime mode:

- `APP_RUNTIME_MODE=full` keeps the current single-process behavior and remains
  the default for local development, tests, and active match operation.
- `APP_RUNTIME_MODE=web` serves the PWA and API but does not start TxLINE or the
  three recurring background loops. The database client remains lazy until a
  request needs it, allowing Railway to sleep the app.
- Parse the environment value through a Zod enum. Reject unknown values at
  startup instead of silently choosing a mode.
- Configure the shared postgres-js client with a 60-second idle timeout so a
  web request cannot keep an unused outbound database connection alive.

Do not add a permanent worker service. It would duplicate Node memory, erase
most of the savings, and conflict with the current one-process PRD. During a
live event, switch production back to `full`; while the product is idle, use
`web`.

## Files

1. `.github/workflows/ci.yml`
   - Set `AUTH_MODE=dev` only inside the integration job.
   - Reuse the intent of existing remote commit `12b1368`; do not change the
     production auth default or Railway variables.
2. `src/api/runtime-mode.ts`
   - Define the Zod-validated `full | web` environment contract.
3. `src/api/runtime-mode.test.ts`
   - Cover the default, both valid values, and rejection of invalid input.
4. `src/api/server.ts`
   - Start and stop background components only in `full` mode.
   - Keep HTTP serving, health checks, auth, and graceful shutdown unchanged.
5. `src/db/client.ts`
   - Close idle pooled Postgres connections after 60 seconds.
6. `src/db/client.test.ts`
   - Verify the shared client is constructed with the idle timeout.
7. `.env.example`
   - Document the local `full` default.
8. `README.md`
   - Document the two modes, the idle-production tradeoff, and the testing
     start/stop procedure, including the database idle timeout.

No dependency or database-schema change is required.

## Validation

1. Run lint, typecheck, unit tests, web tests, integration tests with
   `AUTH_MODE=dev`, and the production build.
2. Run the production entrypoint locally in `web` mode and verify `/api/health`
   without recurring scheduler or TxLINE logs.
3. Verify the shared Postgres client closes idle connections after 60 seconds.
4. Run it in `full` mode and verify the existing background startup behavior.
5. Have the tester agent sign off on the suite and the reviewer agent issue an
   Approve verdict, with special attention to auth isolation and shutdown.
6. Present the exact auth-related workflow diff for manual human review before
   commit or deployment.

## Deployment

1. Commit on a dedicated branch from `main` with a conventional commit.
2. Push the branch and let GitHub Actions prove the integration fix.
3. Merge only after manual review; do not merge `staging` as part of this work.
4. Confirm the new `main` deployment is healthy with the default `full` mode.
5. Set production `APP_RUNTIME_MODE=web` in Railway. Keep Serverless enabled.
6. Verify `/api/health`, then leave the service untouched for more than ten
   minutes and confirm Railway reports `SLEEPING` and compute reaches zero.
7. Leave staging app and Postgres stopped.

## Rollback

- Immediate behavior rollback: set `APP_RUNTIME_MODE=full` and redeploy.
- Code rollback: redeploy the previous successful Railway deployment or revert
  the conventional commit.
- CI rollback: remove the integration-only `AUTH_MODE`; production auth is
  unaffected either way.

## Product tradeoff requiring approval

`web` mode pauses TxLINE ingestion, question transitions, reconciliation, and
settlement. It is appropriate while CupRush is idle, but not during an active
match. A future always-on worker would preserve those behaviors continuously
at the cost of most of the compute savings.
