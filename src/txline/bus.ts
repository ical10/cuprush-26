import { EventEmitter } from "node:events";
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

const FIXTURE_UPDATE = "fixture-update";

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
