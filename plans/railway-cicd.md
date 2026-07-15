# Plan: CI/CD pipeline + Railway deployment (CupRush 26)

## Architecture inventory (what actually runs)

One Node process + one database. No workers, no queues, no Redis (PRD
non-goals).

- **App service**: Hono API (`src/api/server.ts`) — REST + SSE + schedulers +
  TxLINE ingestion; in production also serves the built PWA from
  `dist/client`. Node 22, pnpm 10.28.2 (via `packageManager` + corepack).
  Build = `pnpm install && pnpm build` (Vite → dist/client). Healthcheck:
  `GET /api/health`.
- **Postgres**: Drizzle migrations in `drizzle/`, applied by
  `tsx src/db/migrate.ts`. No native release phase on Railway → run
  migrations as start-command prefix (idempotent, journal-guarded).
- **SSE constraint**: single instance, no horizontal scaling (in-memory bus).
  Railway default 1 replica — fine, do not scale out.

## Environment contract (deploy-time decisions)

| Var | Demo env (now) | Production (post-#13 creds) |
|---|---|---|
| `DATABASE_URL` | Railway Postgres ref `${{Postgres.DATABASE_URL}}` | same |
| `AUTH_MODE` | `dev` (no Privy creds yet) | `privy` |
| `NODE_ENV` | **`development`** — dev auth stub refuses production/prod/staging (by design, commit 682c2ac) | `production` |
| `TXLINE_MODE` | `replay` (demo fixtures, zero creds) | `live` + mainnet creds |
| `PRIVY_APP_ID/SECRET` | unset | HITL #13 |
| `PORT` | Railway-injected | same |

Auth is fail-closed: forgetting `AUTH_MODE` on Railway crashes at boot
(privy default without creds) — correct behavior, documented not "fixed".

**Start command** (override — `pnpm start` hardcodes NODE_ENV=production):
`pnpm db:migrate && tsx --env-file-if-exists=.env src/api/server.ts`
→ simpler: `pnpm exec tsx src/db/migrate.ts && pnpm exec tsx src/api/server.ts`
(env comes from Railway, no .env file in the image).

## CI — GitHub Actions (`.github/workflows/ci.yml`)

Single workflow, push to main + PRs:

1. **checks** job: pnpm setup (corepack, cache), `pnpm lint`,
   `pnpm typecheck`, `pnpm test` (unit incl. web project? unit only —
   plus `npx vitest run --project web`), `pnpm build`.
2. **integration** job: `postgres:16` service container; create
   `worldcup_hilo_test` DB; `DATABASE_URL` env;
   `pnpm test:integration`. Note: script uses `--env-file=.env` → CI needs
   an `.env` written from workflow env or the command invoked directly
   (`node node_modules/vitest/vitest.mjs run --project integration`).
3. No deploy job: Railway GitHub integration auto-deploys `main` and is
   configured to **wait for CI checks** — deploy only on green.

## Railway provisioning (via Railway MCP, this session)

1. New project `cuprush-26`.
2. Postgres service (template).
3. App service connected to GitHub repo `ical10/world-cup-hilo`, branch
   `main` (repo must be pushed/up to date first; brand branch merges before
   first deploy or the service tracks the branch we choose).
4. Variables per demo column above; `DATABASE_URL` as reference variable.
5. Start command override + healthcheck path `/api/health`.
6. `railway.json` (checked in) for build/deploy config that belongs in git.
7. Generate public domain; smoke: `/api/health`, then `pnpm seed:demo`
   equivalent NOT run against Railway (demo seed refuses prod DB only when
   NODE_ENV=production — demo env is development, seeding allowed manually
   if wanted).

## Subagent split

- **Agent CI**: write `.github/workflows/ci.yml` + `railway.json` + README
  deploy section. Verify workflow syntax (actionlint if available), local
  suites still green. No commit.
- **Main session**: Railway MCP ops (project, services, vars, domain) —
  side-effectful, kept where the user can see/approve.
- After both: commit, push, watch first deploy, smoke test.

## Out of scope / HITL

- Privy production credentials, mainnet TxLINE, `AUTH_MODE=privy` flip (#13)
- Custom domain, monitoring/alerting beyond Railway defaults
- Preview environments per PR (Railway supports; add later if wanted)
