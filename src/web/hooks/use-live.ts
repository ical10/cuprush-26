import { useEffect, useReducer } from "react";
import { initialLiveState, liveReducer, parseFixtureUpdate } from "../lib/live-reducer";
import type { LiveState } from "../lib/live-reducer";

const INITIAL_BACKOFF_MS = 3_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Subscribes to GET /api/live via a native EventSource (no library, per
 * issue #12). Snapshot and update events share one reducer, so a
 * duplicate/out-of-order delivery (an ordinary reconnect artifact) never
 * regresses the UI.
 *
 * EventSource auto-reconnects after a network drop, but per spec it closes
 * PERMANENTLY on a non-200 response or wrong content-type (e.g. a proxy 502
 * during a deploy). When that happens we recreate the EventSource ourselves
 * with a capped backoff, so the score never freezes until reload.
 */
export function useLive(): LiveState {
  const [state, dispatch] = useReducer(liveReducer, initialLiveState);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = INITIAL_BACKOFF_MS;
    let disposed = false;

    const onSnapshot = (event: MessageEvent<string>) => {
      const update = parseFixtureUpdate(event.data);
      if (update) dispatch({ type: "snapshot", update });
    };
    const onUpdate = (event: MessageEvent<string>) => {
      const update = parseFixtureUpdate(event.data);
      if (update) dispatch({ type: "update", update });
    };

    const connect = () => {
      const es = new EventSource("/api/live");
      source = es;
      es.addEventListener("snapshot", onSnapshot);
      es.addEventListener("update", onUpdate);
      es.onopen = () => {
        backoffMs = INITIAL_BACKOFF_MS;
      };
      es.onerror = () => {
        // CONNECTING means the browser is retrying on its own — leave it.
        if (disposed || es.readyState !== EventSource.CLOSED) return;
        es.close();
        retryTimer = setTimeout(() => {
          retryTimer = null;
          connect();
        }, backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      };
    };
    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      source?.close();
    };
  }, []);

  return state;
}
