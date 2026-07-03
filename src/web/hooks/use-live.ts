import { useEffect, useReducer } from "react";
import { initialLiveState, liveReducer, parseFixtureUpdate } from "../lib/live-reducer";
import type { LiveState } from "../lib/live-reducer";

/**
 * Subscribes to GET /api/live via a native EventSource (no library, per
 * issue #12). Snapshot and update events share one reducer, so a
 * duplicate/out-of-order delivery (an ordinary reconnect artifact) never
 * regresses the UI.
 */
export function useLive(): LiveState {
  const [state, dispatch] = useReducer(liveReducer, initialLiveState);

  useEffect(() => {
    const source = new EventSource("/api/live");

    const onSnapshot = (event: MessageEvent<string>) => {
      const update = parseFixtureUpdate(event.data);
      if (update) dispatch({ type: "snapshot", update });
    };
    const onUpdate = (event: MessageEvent<string>) => {
      const update = parseFixtureUpdate(event.data);
      if (update) dispatch({ type: "update", update });
    };

    source.addEventListener("snapshot", onSnapshot);
    source.addEventListener("update", onUpdate);

    return () => {
      source.removeEventListener("snapshot", onSnapshot);
      source.removeEventListener("update", onUpdate);
      source.close();
    };
  }, []);

  return state;
}
