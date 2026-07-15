import { EventEmitter } from "node:events";
import { z } from "zod";
import type { FixtureGameState, FixtureStats } from "../db/schema";

// Internal event bus: publishes fixture updates the sequence-guarded apply
// (see apply.ts) actually applied, so other in-process modules (SSE,
// settlement) can subscribe without a queue. One process, one EventEmitter —
// no Redis, no WebSockets.

export type FixtureUpdate = {
  fixtureId: string;
  seq: number;
  gameState: FixtureGameState;
  stats: FixtureStats;
};

const teamStatsSchema = z.object({
  goals: z.number().int().nonnegative(),
  yellowCards: z.number().int().nonnegative(),
  redCards: z.number().int().nonnegative(),
  corners: z.number().int().nonnegative(),
});

const periodStatsSchema = z.object({
  home: teamStatsSchema,
  away: teamStatsSchema,
});

export const fixtureUpdateSchema = z.object({
  fixtureId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  gameState: z.enum([
    "scheduled",
    "live",
    "finished",
    "postponed",
    "cancelled",
    "abandoned",
  ]),
  stats: z.object({
    full_time: periodStatsSchema.optional(),
    first_half: periodStatsSchema.optional(),
    second_half: periodStatsSchema.optional(),
  }),
});

export type FixtureUpdatePublisher = (update: FixtureUpdate) => void | Promise<void>;

export const FIXTURE_UPDATE = "fixture-update";

export const fixtureBus = new EventEmitter();
// Every SSE connection registers a listener; don't warn on many of them.
fixtureBus.setMaxListeners(0);

export function publishFixtureUpdate(update: FixtureUpdate): void {
  fixtureBus.emit(FIXTURE_UPDATE, update);
}

/** Returns an unsubscribe function; always call it on disconnect/cleanup. */
export function onFixtureUpdate(listener: (update: FixtureUpdate) => void): () => void {
  fixtureBus.on(FIXTURE_UPDATE, listener);
  return () => fixtureBus.off(FIXTURE_UPDATE, listener);
}
