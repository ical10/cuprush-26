import { and, eq, like, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { fixtures, questions, type FixtureGameState, type QuestionStatus } from "../db/schema";
import { onFixtureUpdate, type FixtureUpdate } from "../txline/bus";
import {
  createReplayStatsFetcher,
  parseReplayId,
  type ReplayStatsFetcher,
} from "../txline/replay-source";
import { resolveGenerationContext, persistGeneratedQuestions } from "./generate";
import { selectQuestions, type SelectQuestionsOptions } from "./llm-selector";

/**
 * Question lifecycle scheduler.
 *
 * scheduled -> open -> locked are time-driven (a 1-minute tick compares
 * opens_at/locks_at to now). live -> settling -> void are fixture-bus
 * event-driven (see src/txline/bus.ts): the TxLINE game_state on a fixture
 * update decides the next status, never a timer. Settlement itself
 * (settling -> settled, scoring) is issue 9 — this module only ever moves a
 * question *into* settling and leaves the result fields alone.
 *
 * Both kinds of transition are conditional UPDATEs keyed on the expected
 * "from" status, so re-running a tick, or receiving a duplicate fixture
 * event, is a no-op the second time — safe under retries and concurrent
 * fixture updates.
 */

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const DEFAULT_TICK_INTERVAL_MS = 60_000;

// Replay fixtures (seed:replays) have no live event stream: they sit
// `scheduled` with empty stats, and this finisher — once their notional match
// duration has elapsed — fetches the source match's final TxLINE scores
// snapshot, attaches those stats, and flips them `finished` in one update.
// From there the existing catch-up path carries their questions
// locked->live->settling. TxLINE stays the sole stats authority.
const REPLAY_ID_PATTERN = "replay-%";
const DEFAULT_REPLAY_MATCH_DURATION_MS = 30 * 60 * 1000;

/** REPLAY_MATCH_DURATION_MS (env), the notional wall-clock length of a replay. */
export function replayMatchDurationMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.REPLAY_MATCH_DURATION_MS;
  if (raw === undefined) return DEFAULT_REPLAY_MATCH_DURATION_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_REPLAY_MATCH_DURATION_MS;
}

// --- pure lifecycle rules (no DB — see scheduler.test.ts) -------------------

/** scheduled->open at opens_at (kickoff-6h); open->locked at locks_at (kickoff-30m). */
export function timeDrivenTransition(
  status: QuestionStatus,
  opensAt: Date,
  locksAt: Date,
  now: Date,
): QuestionStatus | null {
  if (status === "scheduled" && now.getTime() >= opensAt.getTime()) return "open";
  if (status === "open" && now.getTime() >= locksAt.getTime()) return "locked";
  return null;
}

const PRE_LIVE_STATUSES: QuestionStatus[] = ["scheduled", "open", "locked", "live"];
const VOID_GAME_STATES: FixtureGameState[] = ["postponed", "cancelled", "abandoned"];

/** locked->live at kickoff; live->settling on a terminal fixture; any pre-terminal status->void. */
export function fixtureEventTransition(
  status: QuestionStatus,
  gameState: FixtureGameState,
): QuestionStatus | null {
  if (gameState === "live" && status === "locked") return "live";
  if (gameState === "finished" && status === "live") return "settling";
  if (VOID_GAME_STATES.includes(gameState) && PRE_LIVE_STATUSES.includes(status)) return "void";
  return null;
}

/** A question stuck in `settling` for >= 30 minutes needs attention (issue 9). */
export function isSettlingOverdue(
  settlingAt: Date | null,
  now: Date,
  thresholdMs = THIRTY_MINUTES_MS,
): boolean {
  if (!settlingAt) return false;
  return now.getTime() - settlingAt.getTime() >= thresholdMs;
}

const ALL_STATUSES: QuestionStatus[] = [
  "scheduled",
  "open",
  "locked",
  "live",
  "settling",
  "settled",
  "void",
];

// --- scheduler ---------------------------------------------------------------

export type Clock = () => Date;

export type TickResult = {
  fixturesGenerated: number;
  questionsInserted: number;
  openedCount: number;
  lockedCount: number;
  replaysFinishedCount: number;
  fixtureCatchUpCount: number;
  overdueSettlingCount: number;
};

export type SchedulerOptions = {
  db: Database;
  clock?: Clock;
  intervalMs?: number;
  /** Passed through to the LLM selector for background generation (issue 5). */
  selectorOptions?: SelectQuestionsOptions;
  /**
   * TxLINE stats fetcher the replay finisher calls at finish time. Defaults
   * to one built from env creds; `null` (or absent creds) makes the finisher
   * no-op with a one-time warning instead of crashing the tick.
   */
  replayStatsFetcher?: ReplayStatsFetcher | null;
};

export interface QuestionScheduler {
  /** Subscribes to local fixture updates without starting a timer. */
  subscribe(): void;
  start(): void;
  stop(): void;
  /** Runs one time-driven pass: generation + scheduled->open->locked + overdue scan. */
  tick(): Promise<TickResult>;
  /** Runs one fixture-bus-driven pass for a single fixture update. */
  handleFixtureUpdate(update: FixtureUpdate): Promise<void>;
}

export function createQuestionScheduler(options: SchedulerOptions): QuestionScheduler {
  const { db } = options;
  const clock = options.clock ?? (() => new Date());
  const replayStatsFetcher =
    options.replayStatsFetcher !== undefined
      ? options.replayStatsFetcher
      : createReplayStatsFetcher(process.env);
  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  let replayFetcherWarned = false;

  async function generateForUpcomingFixtures(): Promise<{
    fixturesGenerated: number;
    questionsInserted: number;
  }> {
    const horizon = new Date(clock().getTime() + SIX_HOURS_MS);
    const upcoming = await db
      .select()
      .from(fixtures)
      .where(and(eq(fixtures.gameState, "scheduled"), lte(fixtures.startsAt, horizon)));

    let questionsInserted = 0;
    for (const fixture of upcoming) {
      const ctx = await resolveGenerationContext(db, fixture);
      const { rules } = await selectQuestions(ctx, fixture.stage, options.selectorOptions);
      const result = await persistGeneratedQuestions(db, fixture, rules);
      questionsInserted += result.inserted.length;
    }

    return { fixturesGenerated: upcoming.length, questionsInserted };
  }

  /** scheduled->open and open->locked, each a single conditional UPDATE. */
  async function advanceTimeDrivenStatuses(now: Date): Promise<{ opened: number; locked: number }> {
    const opened = await db
      .update(questions)
      .set({ status: "open" })
      .where(and(eq(questions.status, "scheduled"), lte(questions.opensAt, now)))
      .returning({ id: questions.id });

    const locked = await db
      .update(questions)
      .set({ status: "locked" })
      .where(and(eq(questions.status, "open"), lte(questions.locksAt, now)))
      .returning({ id: questions.id });

    return { opened: opened.length, locked: locked.length };
  }

  /** Logs (doesn't transition — settlement is issue 9) questions overdue past the 30m deadline. */
  async function scanOverdueSettling(now: Date): Promise<number> {
    const settling = await db
      .select({ id: questions.id, settlingAt: questions.settlingAt })
      .from(questions)
      .where(eq(questions.status, "settling"));

    const overdue = settling.filter((row) => isSettlingOverdue(row.settlingAt, now));
    if (overdue.length > 0) {
      console.log(
        JSON.stringify({
          event: "settlement_overdue",
          count: overdue.length,
          questionIds: overdue.map((row) => row.id),
        }),
      );
    }
    return overdue.length;
  }

  /**
   * Finishes due replay fixtures (id LIKE 'replay-%', still `scheduled`, past
   * startsAt + REPLAY_MATCH_DURATION_MS): fetches each one's source match from
   * TxLINE, writes the final stats and `finished` in a single conditional
   * update. Runs before catchUpFixtureDrivenStatuses in the tick, so the same
   * pass carries the fixture's now-locked questions locked->live->settling.
   *
   * A fetch/parse failure logs once and leaves the fixture `scheduled` — the
   * next tick retries (the tick cadence is the retry bound). With no fetcher
   * (creds absent), it warns once and no-ops rather than crashing the tick.
   */
  async function finishDueReplayFixtures(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - replayMatchDurationMs());
    const due = await db
      .select({ id: fixtures.id })
      .from(fixtures)
      .where(
        and(
          like(fixtures.id, REPLAY_ID_PATTERN),
          eq(fixtures.gameState, "scheduled"),
          lte(fixtures.startsAt, cutoff),
        ),
      );
    if (due.length === 0) return 0;

    if (!replayStatsFetcher) {
      if (!replayFetcherWarned) {
        replayFetcherWarned = true;
        console.warn(
          JSON.stringify({
            event: "replay_finisher_disabled",
            reason: "no TxLINE creds (TXLINE_BASE_URL/TXLINE_API_KEY) — replay fixtures will not finish here",
            pendingReplayCount: due.length,
          }),
        );
      }
      return 0;
    }

    let finished = 0;
    for (const { id } of due) {
      const parsed = parseReplayId(id);
      if (!parsed) continue;
      try {
        const { stats, lastSeq } = await replayStatsFetcher(parsed.sourceId);
        const updated = await db
          .update(fixtures)
          .set({ gameState: "finished", stats, lastSeq })
          .where(and(eq(fixtures.id, id), eq(fixtures.gameState, "scheduled")))
          .returning({ id: fixtures.id });
        finished += updated.length;
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "replay_finish_failed",
            fixtureId: id,
            sourceId: parsed.sourceId,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    return finished;
  }

  async function catchUpFixtureDrivenStatuses(now: Date): Promise<number> {
    const currentFixtures = await db
      .select({ id: fixtures.id, gameState: fixtures.gameState })
      .from(fixtures);
    let transitioned = 0;

    for (const fixture of currentFixtures) {
      if (fixture.gameState === "live" || fixture.gameState === "finished") {
        const live = await db
          .update(questions)
          .set({ status: "live" })
          .where(
            and(eq(questions.fixtureId, fixture.id), eq(questions.status, "locked")),
          )
          .returning({ id: questions.id });
        transitioned += live.length;
      }

      if (fixture.gameState === "finished") {
        const settling = await db
          .update(questions)
          .set({ status: "settling", settlingAt: now })
          .where(and(eq(questions.fixtureId, fixture.id), eq(questions.status, "live")))
          .returning({ id: questions.id });
        transitioned += settling.length;
      }

      if (VOID_GAME_STATES.includes(fixture.gameState)) {
        for (const status of PRE_LIVE_STATUSES) {
          const voided = await db
            .update(questions)
            .set({ status: "void" })
            .where(and(eq(questions.fixtureId, fixture.id), eq(questions.status, status)))
            .returning({ id: questions.id });
          transitioned += voided.length;
        }
      }
    }

    return transitioned;
  }

  async function tick(): Promise<TickResult> {
    const now = clock();
    const { fixturesGenerated, questionsInserted } = await generateForUpcomingFixtures();
    const { opened, locked } = await advanceTimeDrivenStatuses(now);
    const replaysFinishedCount = await finishDueReplayFixtures(now);
    const fixtureCatchUpCount = await catchUpFixtureDrivenStatuses(now);
    const overdueSettlingCount = await scanOverdueSettling(now);

    return {
      fixturesGenerated,
      questionsInserted,
      openedCount: opened,
      lockedCount: locked,
      replaysFinishedCount,
      fixtureCatchUpCount,
      overdueSettlingCount,
    };
  }

  /**
   * One conditional UPDATE per candidate "from" status — race-safe: a
   * question only moves if it's still in exactly the status
   * fixtureEventTransition expected when the event arrived.
   */
  async function handleFixtureUpdate(update: FixtureUpdate): Promise<void> {
    const now = clock();

    for (const from of ALL_STATUSES) {
      const to = fixtureEventTransition(from, update.gameState);
      if (!to) continue;

      await db
        .update(questions)
        .set(to === "settling" ? { status: to, settlingAt: now } : { status: to })
        .where(and(eq(questions.fixtureId, update.fixtureId), eq(questions.status, from)));
    }
  }

  return {
    subscribe() {
      if (unsubscribe) return;
      unsubscribe = onFixtureUpdate((update) => {
        void handleFixtureUpdate(update).catch((error: unknown) => {
          console.error("Failed to handle fixture update", error);
        });
      });
    },
    start() {
      this.subscribe();
      void tick().catch((error: unknown) => {
        console.error("Question scheduler tick failed", error);
      });
      timer = setInterval(() => {
        void tick().catch((error: unknown) => {
          console.error("Question scheduler tick failed", error);
        });
      }, options.intervalMs ?? DEFAULT_TICK_INTERVAL_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
      unsubscribe?.();
      unsubscribe = undefined;
    },
    tick,
    handleFixtureUpdate,
  };
}
