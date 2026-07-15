import { afterEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_UPDATE, fixtureBus, onFixtureUpdate } from "./bus";
import {
  createPostgresFixtureBridge,
  createPostgresFixturePublisher,
  FIXTURE_UPDATE_CHANNEL,
  parseFixtureUpdateNotification,
} from "./postgres-bus";

const update = { fixtureId: "fixture-1", seq: 3, gameState: "live" as const, stats: {} };

afterEach(() => {
  fixtureBus.removeAllListeners(FIXTURE_UPDATE);
  vi.restoreAllMocks();
});

describe("fixture notification validation", () => {
  it("accepts a valid update and rejects malformed external input", () => {
    expect(parseFixtureUpdateNotification(JSON.stringify(update))).toEqual(update);
    expect(parseFixtureUpdateNotification("not-json")).toBeNull();
    expect(parseFixtureUpdateNotification(JSON.stringify({ ...update, seq: -1 }))).toBeNull();
  });

  it("publishes locally and notifies Postgres", async () => {
    const notify = vi.fn(async () => []);
    const listener = vi.fn();
    const unsubscribe = onFixtureUpdate(listener);

    await createPostgresFixturePublisher({ notify })(update);

    expect(listener).toHaveBeenCalledWith(update);
    expect(notify).toHaveBeenCalledWith(FIXTURE_UPDATE_CHANNEL, JSON.stringify(update));
    unsubscribe();
  });
});

describe("createPostgresFixtureBridge", () => {
  it("shares one listener, validates notifications, signals reconnects, and closes when idle", async () => {
    let onNotify: ((payload: string) => void) | undefined;
    let onListen: (() => void) | undefined;
    const unlisten = vi.fn(async () => {});
    const end = vi.fn(async () => {});
    const createClient = vi.fn(() => ({
      listen: vi.fn(async (_channel: string, notify: (payload: string) => void, listened?: () => void) => {
        onNotify = notify;
        onListen = listened;
        listened?.();
        return { unlisten };
      }),
      end,
    }));
    const reconnectA = vi.fn();
    const reconnectB = vi.fn();
    const delivered = vi.fn();
    const unsubscribe = onFixtureUpdate(delivered);
    const bridge = createPostgresFixtureBridge({ createClient });

    const releaseA = await bridge.acquire(reconnectA);
    const releaseB = await bridge.acquire(reconnectB);
    expect(createClient).toHaveBeenCalledOnce();

    onNotify?.(JSON.stringify(update));
    onNotify?.("malformed");
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(delivered).toHaveBeenCalledWith(update);

    onListen?.();
    expect(reconnectA).toHaveBeenCalledOnce();
    expect(reconnectB).toHaveBeenCalledOnce();

    await releaseA();
    expect(unlisten).not.toHaveBeenCalled();
    await releaseB();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
