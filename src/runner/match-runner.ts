import { fileURLToPath } from "node:url";
import { and, eq, gte, inArray, lte, or } from "drizzle-orm";
import type { Database } from "../db/client";
import { fixtures, questions } from "../db/schema";
import type { TxLineClient } from "../txline/client";
import type { QuestionScheduler } from "../questions/scheduler";

export const MATCH_RUNNER_LOCK_KEY = 2_026_072_600;
export const ACTIVE_LEAD_MS = 40 * 60_000;
export const RECENT_LIVE_MS = 4 * 60 * 60_000;
export const SCHEDULED_RECOVERY_MS = 4 * 60 * 60_000;
export const POLL_INTERVAL_MS = 60_000;
export const IDLE_CONFIRMATION_MS = 5_000;
export const MAX_RUNTIME_MS = 6 * 60 * 60_000;

type QueryClient = typeof import("../db/client").queryClient;
type ReservedConnection = Awaited<ReturnType<QueryClient["reserve"]>>;

export type AdvisoryLock = {
  acquire(): Promise<boolean>;
  release(): Promise<void>;
};

export type MatchRunnerDependencies = {
  lock: AdvisoryLock;
  scheduler: Pick<QuestionScheduler, "subscribe" | "stop" | "tick">;
  txLineClient: TxLineClient;
  reconcile(): Promise<unknown>;
  settle(): Promise<unknown>;
  hasActiveWork(now: Date): Promise<boolean>;
};

export type MatchRunnerOptions = MatchRunnerDependencies & {
  signal?: AbortSignal;
  clock?: () => Date;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  pollIntervalMs?: number;
  idleConfirmationMs?: number;
  maxRuntimeMs?: number;
};

export type MatchRunnerResult =
  | { outcome: "lock_contended"; cycles: 0 }
  | { outcome: "idle" | "max_runtime" | "aborted"; cycles: number };

export type MatchRunnerChainConfig = {
  writesEnabled: boolean;
};

export function readMatchRunnerChainConfig(
  env: NodeJS.ProcessEnv = process.env,
): MatchRunnerChainConfig {
  const writesEnabled = env.MATCH_RUNNER_CHAIN_WRITES === "enabled";
  if (writesEnabled && env.CHAIN_MODE !== "solana") {
    throw new Error(
      "MATCH_RUNNER_CHAIN_WRITES=enabled requires CHAIN_MODE=solana",
    );
  }
  return { writesEnabled };
}

export function createPostgresAdvisoryLock(client: QueryClient): AdvisoryLock {
  let connection: ReservedConnection | undefined;
  let acquired = false;

  return {
    async acquire() {
      if (connection) throw new Error("match-runner advisory lock was already acquired");
      connection = await client.reserve();
      try {
        const [row] = await connection<{ acquired: boolean }[]>`
          select pg_try_advisory_lock(${MATCH_RUNNER_LOCK_KEY}) as acquired
        `;
        acquired = row?.acquired === true;
        return acquired;
      } catch (error) {
        connection.release();
        connection = undefined;
        throw error;
      }
    },
    async release() {
      const current = connection;
      if (!current) return;
      connection = undefined;
      try {
        if (acquired) {
          await current`select pg_advisory_unlock(${MATCH_RUNNER_LOCK_KEY})`;
        }
      } finally {
        acquired = false;
        current.release();
      }
    },
  };
}

export async function hasActiveMatchWork(
  db: Database,
  now: Date = new Date(),
  includeSettlingQuestions = false,
): Promise<boolean> {
  const upcoming = new Date(now.getTime() + ACTIVE_LEAD_MS);
  const scheduledRecovery = new Date(now.getTime() - SCHEDULED_RECOVERY_MS);
  const recentLive = new Date(now.getTime() - RECENT_LIVE_MS);
  const activeFixtures = await db
    .select({ id: fixtures.id })
    .from(fixtures)
    .where(
      or(
        and(
          eq(fixtures.gameState, "scheduled"),
          gte(fixtures.startsAt, scheduledRecovery),
          lte(fixtures.startsAt, upcoming),
        ),
        and(eq(fixtures.gameState, "live"), gte(fixtures.startsAt, recentLive)),
      ),
    )
    .limit(1);
  if (activeFixtures.length > 0) return true;

  const activeQuestions = await db
    .select({ id: questions.id })
    .from(questions)
    .where(
      inArray(
        questions.status,
        includeSettlingQuestions ? ["live", "settling"] : ["live"],
      ),
    )
    .limit(1);
  return activeQuestions.length > 0;
}

export function abortableSleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (milliseconds <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });

    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    }
  });
}

async function waitForDelayOrFailure(
  milliseconds: number,
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  failure: Promise<Error>,
  signal?: AbortSignal,
): Promise<Error | undefined> {
  const delayController = new AbortController();
  const abortDelay = () => delayController.abort(signal?.reason);
  if (signal?.aborted) abortDelay();
  else signal?.addEventListener("abort", abortDelay, { once: true });

  try {
    return await Promise.race([
      sleep(milliseconds, delayController.signal).then(() => undefined),
      failure.then((error) => {
        delayController.abort(error);
        return error;
      }),
    ]);
  } finally {
    signal?.removeEventListener("abort", abortDelay);
    delayController.abort();
  }
}

export async function runMatchRunner(options: MatchRunnerOptions): Promise<MatchRunnerResult> {
  const clock = options.clock ?? (() => new Date());
  const sleep = options.sleep ?? abortableSleep;
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const idleConfirmationMs = options.idleConfirmationMs ?? IDLE_CONFIRMATION_MS;
  const maxRuntimeMs = options.maxRuntimeMs ?? MAX_RUNTIME_MS;
  const startedAt = clock().getTime();
  let cycles = 0;
  let clientInitialized = false;
  let subscribed = false;

  if (!(await options.lock.acquire())) {
    await options.lock.release();
    return { outcome: "lock_contended", cycles: 0 };
  }

  try {
    options.scheduler.subscribe();
    subscribed = true;
    clientInitialized = true;
    await options.txLineClient.prepare(options.signal);
    await options.scheduler.tick();
    cycles += 1;
    await options.reconcile();
    await options.settle();

    if (options.signal?.aborted) return { outcome: "aborted", cycles };
    let active = await options.hasActiveWork(clock());
    if (!active) {
      await sleep(idleConfirmationMs, options.signal);
      if (options.signal?.aborted) return { outcome: "aborted", cycles };
      active = await options.hasActiveWork(clock());
      if (!active) return { outcome: "idle", cycles };
    }

    await options.txLineClient.start(options.signal);
    await options.scheduler.tick();
    cycles += 1;

    while (!options.signal?.aborted) {
      if (cycles > 0 && clock().getTime() - startedAt >= maxRuntimeMs) {
        return { outcome: "max_runtime", cycles };
      }

      await options.reconcile();
      await options.settle();

      active = await options.hasActiveWork(clock());
      console.log(JSON.stringify({ event: "match_runner_cycle", cycles, active }));

      if (clock().getTime() - startedAt >= maxRuntimeMs) {
        return { outcome: "max_runtime", cycles };
      }

      if (active) {
        const failure = await waitForDelayOrFailure(
          pollIntervalMs,
          sleep,
          options.txLineClient.waitForFailure(),
          options.signal,
        );
        if (failure) throw failure;
        if (!options.signal?.aborted) {
          await options.scheduler.tick();
          cycles += 1;
        }
        continue;
      }

      const failure = await waitForDelayOrFailure(
        idleConfirmationMs,
        sleep,
        options.txLineClient.waitForFailure(),
        options.signal,
      );
      if (failure) throw failure;
      if (options.signal?.aborted) break;
      if (!(await options.hasActiveWork(clock()))) {
        return { outcome: "idle", cycles };
      }
    }

    return { outcome: "aborted", cycles };
  } catch (error) {
    if (options.signal?.aborted) return { outcome: "aborted", cycles };
    throw error;
  } finally {
    if (subscribed) options.scheduler.stop();
    if (clientInitialized) await options.txLineClient.stop().catch(() => {});
    await options.lock.release();
  }
}

export async function runProductionMatchRunner(
  env: NodeJS.ProcessEnv = process.env,
): Promise<MatchRunnerResult> {
  const chainConfig = readMatchRunnerChainConfig(env);
  const [{ db, queryClient }, txLine, schedulerModule, postgresBus] =
    await Promise.all([
      import("../db/client"),
      import("../txline/client"),
      import("../questions/scheduler"),
      import("../txline/postgres-bus"),
    ]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.once("SIGINT", abort);
  process.once("SIGTERM", abort);

  const questionScheduler = schedulerModule.createQuestionScheduler({ db });
  let reconcile = async () => {};
  let settle = async () => {};

  if (chainConfig.writesEnabled) {
    const [{ createChainAdapterFromEnv }, reconcilerModule, settlementModule] =
      await Promise.all([
        import("../chain"),
        import("../predictions/reconciler"),
        import("../questions/settle"),
      ]);
    const chain = createChainAdapterFromEnv(env);
    const predictionReconciler = reconcilerModule.createPredictionReconciler({
      db,
      adapter: chain,
    });
    const settlementExecutor = settlementModule.createSettlementExecutor({ db, chain });
    reconcile = () => predictionReconciler.tick().then(() => undefined);
    settle = () => settlementExecutor.runOnce().then(() => undefined);
  }
  const txLineClient = txLine.createTxLineClient({
    db,
    env,
    fixturesDir: env.TXLINE_FIXTURES_DIR,
    intervalMs: 0,
    publishUpdate: postgresBus.createPostgresFixturePublisher(queryClient),
  });

  try {
    return await runMatchRunner({
      lock: createPostgresAdvisoryLock(queryClient),
      scheduler: questionScheduler,
      txLineClient,
      reconcile,
      settle,
      hasActiveWork: (now) => hasActiveMatchWork(db, now, chainConfig.writesEnabled),
      signal: controller.signal,
    });
  } finally {
    process.removeListener("SIGINT", abort);
    process.removeListener("SIGTERM", abort);
    await queryClient.end({ timeout: 5 }).catch(() => {});
  }
}

const isEntryPoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntryPoint) {
  runProductionMatchRunner()
    .then((result) => {
      console.log(JSON.stringify({ event: "match_runner_complete", ...result }));
    })
    .catch((error: unknown) => {
      console.error("Match runner failed", error);
      process.exitCode = 1;
    });
}
