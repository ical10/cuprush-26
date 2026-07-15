import postgres from "postgres";
import {
  fixtureUpdateSchema,
  publishFixtureUpdate,
  type FixtureUpdate,
  type FixtureUpdatePublisher,
} from "./bus";

export const FIXTURE_UPDATE_CHANNEL = "cuprush_fixture_update";

type NotifyClient = {
  notify(channel: string, payload: string): Promise<unknown>;
};

type ListenHandle = {
  unlisten(): Promise<void>;
};

type ListenClient = {
  listen(
    channel: string,
    onNotify: (payload: string) => void,
    onListen?: () => void,
  ): Promise<ListenHandle>;
  end(options?: { timeout?: number }): Promise<void>;
};

export type FixtureNotificationBridge = {
  acquire(onReconnect: () => void): Promise<() => Promise<void>>;
};

export function parseFixtureUpdateNotification(payload: string): FixtureUpdate | null {
  try {
    const parsed = fixtureUpdateSchema.safeParse(JSON.parse(payload));
    if (!parsed.success) {
      console.error("Discarding invalid fixture notification", parsed.error.message);
      return null;
    }
    return parsed.data;
  } catch {
    console.error("Discarding non-JSON fixture notification");
    return null;
  }
}

export function createPostgresFixturePublisher(client: NotifyClient): FixtureUpdatePublisher {
  return async (update) => {
    publishFixtureUpdate(update);
    try {
      await client.notify(FIXTURE_UPDATE_CHANNEL, JSON.stringify(update));
    } catch (error) {
      console.error("Failed to publish fixture notification", error);
    }
  };
}

export type PostgresFixtureBridgeOptions = {
  createClient: () => ListenClient | Promise<ListenClient>;
};

export function createPostgresFixtureBridge(
  options: PostgresFixtureBridgeOptions,
): FixtureNotificationBridge {
  const consumers = new Map<symbol, () => void>();
  let client: ListenClient | undefined;
  let handle: ListenHandle | undefined;
  let lifecycle = Promise.resolve();

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = lifecycle.then(operation, operation);
    lifecycle = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function start(): Promise<void> {
    if (client) return;

    const nextClient = await options.createClient();
    let listening = false;
    try {
      const nextHandle = await nextClient.listen(
        FIXTURE_UPDATE_CHANNEL,
        (payload) => {
          const update = parseFixtureUpdateNotification(payload);
          if (update) publishFixtureUpdate(update);
        },
        () => {
          if (!listening) {
            listening = true;
            return;
          }
          for (const onReconnect of consumers.values()) onReconnect();
        },
      );
      client = nextClient;
      handle = nextHandle;
    } catch (error) {
      await nextClient.end({ timeout: 1 }).catch(() => {});
      throw error;
    }
  }

  async function stop(): Promise<void> {
    const currentClient = client;
    const currentHandle = handle;
    client = undefined;
    handle = undefined;

    await currentHandle?.unlisten().catch(() => {});
    await currentClient?.end({ timeout: 1 }).catch(() => {});
  }

  return {
    async acquire(onReconnect) {
      const token = Symbol("fixture-notification-consumer");
      consumers.set(token, onReconnect);

      try {
        await serialize(start);
      } catch (error) {
        consumers.delete(token);
        throw error;
      }

      let released = false;
      return async () => {
        if (released) return;
        released = true;
        consumers.delete(token);
        await serialize(async () => {
          if (consumers.size === 0) await stop();
        });
      };
    },
  };
}

export function createPostgresFixtureBridgeFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FixtureNotificationBridge {
  return createPostgresFixtureBridge({
    createClient() {
      const databaseUrl = env.DATABASE_URL;
      if (!databaseUrl) throw new Error("DATABASE_URL is required");
      return postgres(databaseUrl, {
        max: 1,
      });
    },
  });
}
