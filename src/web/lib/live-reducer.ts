import type { FixtureUpdate } from "./types";

export type LiveState = Record<string, FixtureUpdate>;

export type LiveAction =
  | { type: "snapshot" | "update"; update: FixtureUpdate };

export const initialLiveState: LiveState = {};

/**
 * Applies a snapshot or update event from GET /api/live. Mirrors the
 * server's sequence guard: a fixture is only ever moved forward, so a
 * duplicate or out-of-order event (a common reconnect artifact) is a
 * silent no-op rather than a flicker back to stale data.
 */
export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  const { update } = action;
  const current = state[update.fixtureId];
  if (current && current.seq >= update.seq) return state;
  return { ...state, [update.fixtureId]: update };
}

export function parseFixtureUpdate(raw: string): FixtureUpdate | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (
      typeof data === "object" &&
      data !== null &&
      "fixtureId" in data &&
      "seq" in data &&
      "gameState" in data &&
      "stats" in data
    ) {
      return data as FixtureUpdate;
    }
    return null;
  } catch {
    return null;
  }
}
