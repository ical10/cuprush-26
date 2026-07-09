import { and, eq, lte } from "drizzle-orm";
import type { Database } from "../db/client";
import { fixtures, questions, type FixtureGameState, type QuestionStatus } from "../db/schema";
import { onFixtureUpdate, type FixtureUpdate } from "../txline/bus";
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
  overdueSettlingCount: number;
};

export type SchedulerOptions = {
  db: Database;
  clock?: Clock;
  intervalMs?: number;
  /** Passed through to the LLM selector for background generation (issue 5). */
  selectorOptions?: SelectQuestionsOptions;
};

export interface QuestionScheduler {
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
  let timer: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

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

  async function tick(): Promise<TickResult> {
    const now = clock();
    const { fixturesGenerated, questionsInserted } = await generateForUpcomingFixtures();
    const { opened, locked } = await advanceTimeDrivenStatuses(now);
    const overdueSettlingCount = await scanOverdueSettling(now);

    return {
      fixturesGenerated,
      questionsInserted,
      openedCount: opened,
      lockedCount: locked,
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

  // Background ticks and fixture-update handlers are fire-and-forget. A
  // throw inside one (e.g. a transient DB connect timeout) would surface as
  // an unhandled promise rejection and crash the whole process — which is
  // exactly how a momentary Postgres blip left production dead for two days.
  // Swallow-and-log instead; the next interval retries.
  async function runGuarded(what: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      console.error(`Scheduler ${what} failed; continuing`, error);
    }
  }

  return {
    start() {
      unsubscribe = onFixtureUpdate((update) => {
        void runGuarded("fixture-update handler", () => handleFixtureUpdate(update));
      });
      void runGuarded("tick", tick);
      timer = setInterval(
        () => void runGuarded("tick", tick),
        options.intervalMs ?? DEFAULT_TICK_INTERVAL_MS,
      );
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
