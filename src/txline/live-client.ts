import { z } from "zod";
import type { Database } from "../db/client";
import { fixtures } from "../db/schema";
import { applyTxLineEvent, toFixtureUpdate } from "./apply";
import { publishFixtureUpdate, type FixtureUpdatePublisher } from "./bus";
import {
  parseScoreSnapshot,
  txLineFixtureListSchema,
  txLineWireEventSchema,
  wireEventToTxLineEvent,
  type TxLineEvent,
  type TxLineFixtureSnapshot,
} from "./schema";
import type { TxLineClient } from "./client";

/**
 * Live mode: connects to the real TxLINE API.
 *
 * Wire contract (verified against devnet; see fixtures/captured/):
 * - `POST {origin}/auth/guest/start` mints a guest JWT (no auth, no body).
 * - Every data call carries `Authorization: Bearer <jwt>` and
 *   `X-Api-Token: <apiKey>`. A 401 re-mints the JWT once and retries once.
 * - Boot: `GET /api/fixtures/snapshot` upserts fixtures, then
 *   `GET /api/scores/snapshot/{fixtureId}` replays each fixture's
 *   Score-bearing events (sorted by Seq), then `GET /api/scores/stream`
 *   (SSE) feeds the same validate→apply→publish pipeline.
 *
 * The HTTP specifics stay isolated in this one file; everything downstream
 * only sees validated TxLineEvent objects.
 */

export type TxLineLiveConfig = {
  baseUrl: string;
  apiKey: string;
};

export function readLiveConfig(env: NodeJS.ProcessEnv): TxLineLiveConfig {
  const rawBaseUrl = env.TXLINE_BASE_URL;
  const apiKey = env.TXLINE_API_KEY;
  if (!rawBaseUrl || !apiKey) {
    throw new Error(
      "TXLINE_BASE_URL and TXLINE_API_KEY are required when TXLINE_MODE=live",
    );
  }

  let baseUrl = rawBaseUrl.replace(/\/+$/, "");
  if (baseUrl.endsWith("/api")) {
    baseUrl = baseUrl.slice(0, -"/api".length);
    console.warn(
      "TXLINE_BASE_URL should be the TxLINE origin without /api — ignoring the trailing /api segment",
    );
  }

  return { baseUrl, apiKey };
}

export type FetchLike = typeof fetch;

export type AuthorizedFetchInit = {
  signal?: AbortSignal;
  accept?: string;
};

const guestTokenSchema = z.object({ token: z.string().min(1) });

/**
 * Wraps fetch with TxLINE auth: lazily mints a guest JWT, sends both auth
 * headers on every call, and on a 401 re-mints once and retries once. A 401
 * on the retry throws.
 */
export function createAuthorizedFetch(
  config: TxLineLiveConfig,
  fetchImpl: FetchLike = fetch,
): (path: string, init?: AuthorizedFetchInit) => Promise<Response> {
  let jwt: string | null = null;

  async function mintJwt(signal?: AbortSignal): Promise<string> {
    const res = await fetchImpl(new URL("/auth/guest/start", config.baseUrl), {
      method: "POST",
      signal,
    });
    if (!res.ok) {
      throw new Error(`TxLINE guest JWT mint failed: ${res.status} ${res.statusText}`);
    }
    return guestTokenSchema.parse(await res.json()).token;
  }

  return async function authorizedFetch(path, init = {}) {
    jwt ??= await mintJwt(init.signal);

    const request = () =>
      fetchImpl(new URL(path, config.baseUrl), {
        headers: {
          Authorization: `Bearer ${jwt}`,
          "X-Api-Token": config.apiKey,
          ...(init.accept ? { Accept: init.accept } : {}),
        },
        signal: init.signal,
      });

    let res = await request();
    if (res.status === 401) {
      jwt = await mintJwt(init.signal);
      res = await request();
      if (res.status === 401) {
        throw new Error(`TxLINE request still unauthorized after re-minting the guest JWT (${path})`);
      }
    }
    return res;
  };
}

export type SseFrame = {
  data: string;
  event?: string;
  id?: string;
};

/**
 * Minimal text/event-stream parser: accumulates `data:` lines (joined with
 * newlines), captures `event:`/`id:`, skips `:` comment lines, and emits a
 * frame on each blank line. An incomplete trailing frame is discarded, per
 * the SSE spec.
 */
export async function* parseSseStream(
  chunks: AsyncIterable<string>,
): AsyncGenerator<SseFrame> {
  let dataLines: string[] = [];
  let eventName: string | undefined;
  let id: string | undefined;

  function flush(): SseFrame | null {
    const frame: SseFrame | null =
      dataLines.length === 0
        ? null
        : {
            data: dataLines.join("\n"),
            ...(eventName !== undefined ? { event: eventName } : {}),
            ...(id !== undefined ? { id } : {}),
          };
    dataLines = [];
    eventName = undefined;
    id = undefined;
    return frame;
  }

  function handleLine(rawLine: string): SseFrame | null {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") return flush();
    if (line.startsWith(":")) return null;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "data") dataLines.push(value);
    else if (field === "event") eventName = value;
    else if (field === "id") id = value;
    return null;
  }

  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      const frame = handleLine(line);
      if (frame) yield frame;
    }
  }
}

/**
 * Turns SSE text chunks into raw (unvalidated) TxLINE event payloads:
 * heartbeat frames are skipped entirely (their `Ts` is in seconds and must
 * never reach the event schema), non-JSON data is logged and dropped.
 */
export async function* sseEventsFromChunks(
  chunks: AsyncIterable<string>,
): AsyncGenerator<unknown> {
  for await (const frame of parseSseStream(chunks)) {
    if (frame.event === "heartbeat") continue;
    try {
      yield JSON.parse(frame.data);
    } catch {
      console.error("Discarding non-JSON TxLINE stream frame");
    }
  }
}

async function* decodeChunks(body: NonNullable<Response["body"]>): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export type LiveClientOptions = {
  db: Database;
  env: NodeJS.ProcessEnv;
  /** Test seam; defaults to global fetch. */
  fetchImpl?: FetchLike;
  publishUpdate?: FixtureUpdatePublisher;
  reconnectDelaysMs?: number[];
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

const DEFAULT_RECONNECT_DELAYS_MS = [1_000, 5_000, 15_000];

function sleepWithSignal(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

export function createLiveTxLineClient(options: LiveClientOptions): TxLineClient {
  const config = readLiveConfig(options.env);
  const authorizedFetch = createAuthorizedFetch(config, options.fetchImpl ?? fetch);
  const publishUpdate = options.publishUpdate ?? publishFixtureUpdate;
  const reconnectDelaysMs = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
  const sleep = options.sleep ?? sleepWithSignal;
  let controller: AbortController | null = null;
  let loop: Promise<void> | null = null;
  let detachExternalAbort: (() => void) | undefined;
  let preparedSnapshots: TxLineFixtureSnapshot[] | null = null;
  let resolveFailure: ((error: Error) => void) | undefined;
  const failure = new Promise<Error>((resolve) => {
    resolveFailure = resolve;
  });

  async function fetchJson(path: string, signal: AbortSignal): Promise<unknown> {
    const res = await authorizedFetch(path, { signal });
    if (!res.ok) {
      throw new Error(`TxLINE request failed: ${res.status} ${res.statusText} (${path})`);
    }
    return res.json();
  }

  async function applyEvent(event: TxLineEvent): Promise<void> {
    const outcome = await applyTxLineEvent(options.db, event);
    if (outcome.applied) {
      await publishUpdate(toFixtureUpdate(outcome.fixture));
    }
  }

  async function discoverFixtures(signal: AbortSignal): Promise<TxLineFixtureSnapshot[]> {
    const raw = await fetchJson("/api/fixtures/snapshot", signal);
    const snapshots = txLineFixtureListSchema.parse(raw);

    for (const snapshot of snapshots) {
      await options.db
        .insert(fixtures)
        .values({
          id: snapshot.fixtureId,
          homeTeam: snapshot.homeTeam,
          awayTeam: snapshot.awayTeam,
          startsAt: new Date(snapshot.startsAt),
          gameState: snapshot.gameState,
          lastSeq: snapshot.seq,
          stats: snapshot.stats,
        })
        .onConflictDoUpdate({
          target: fixtures.id,
          set: {
            homeTeam: snapshot.homeTeam,
            awayTeam: snapshot.awayTeam,
            startsAt: new Date(snapshot.startsAt),
          },
        });
    }
    preparedSnapshots = snapshots;
    return snapshots;
  }

  async function seedScores(
    snapshots: TxLineFixtureSnapshot[],
    signal: AbortSignal,
  ): Promise<void> {
    for (const snapshot of snapshots) {
      signal.throwIfAborted();
      const events = parseScoreSnapshot(
        await fetchJson(`/api/scores/snapshot/${snapshot.fixtureId}`, signal),
      );
      for (const event of events) {
        await applyEvent(event);
      }
    }
  }

  async function* streamEvents(
    signal: AbortSignal,
    onConnected: () => void,
  ): AsyncGenerator<unknown> {
    const res = await authorizedFetch("/api/scores/stream", {
      signal,
      accept: "text/event-stream",
    });
    if (!res.ok || !res.body) {
      throw new Error(`TxLINE stream request failed: ${res.status} ${res.statusText}`);
    }
    onConnected();
    yield* sseEventsFromChunks(decodeChunks(res.body));
  }

  async function consumeStream(
    signal: AbortSignal,
    onConnected: () => void,
  ): Promise<void> {
    for await (const raw of streamEvents(signal, onConnected)) {
      if (signal.aborted) return;
      const wire = txLineWireEventSchema.safeParse(raw);
      if (!wire.success) {
        console.error("Discarding invalid TxLINE event", wire.error.message);
        continue;
      }
      const event = wireEventToTxLineEvent(wire.data);
      if (!event) continue; // informational action without a Score
      await applyEvent(event);
    }
    if (!signal.aborted) throw new Error("TxLINE live stream ended unexpectedly");
  }

  async function runWithReconnect(
    signal: AbortSignal,
    onConnected: () => void,
  ): Promise<void> {
    let connected = false;
    let lastError: unknown;

    for (let attempt = 0; attempt <= reconnectDelaysMs.length; attempt += 1) {
      if (signal.aborted) return;
      try {
        if (attempt > 0) {
          const snapshots = await discoverFixtures(signal);
          await seedScores(snapshots, signal);
        }
        await consumeStream(signal, () => {
          if (!connected) {
            connected = true;
            onConnected();
          }
        });
        return;
      } catch (error) {
        if (signal.aborted) return;
        lastError = error;
        const delay = reconnectDelaysMs[attempt];
        if (delay === undefined) break;
        await sleep(delay, signal);
      }
    }

    throw new Error("TxLINE live stream exhausted reconnect attempts", {
      cause: lastError,
    });
  }

  return {
    async prepare(signal) {
      if (preparedSnapshots) return;
      if (controller) throw new Error("TxLINE live client already started");
      const preparationController = new AbortController();
      const abort = () => preparationController.abort(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      try {
        signal?.throwIfAborted();
        await discoverFixtures(preparationController.signal);
      } finally {
        signal?.removeEventListener("abort", abort);
      }
    },
    async start(signal) {
      if (controller) return;
      const nextController = new AbortController();
      const abort = () => nextController.abort(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      detachExternalAbort = () => signal?.removeEventListener("abort", abort);
      controller = nextController;
      try {
        signal?.throwIfAborted();
        if (!preparedSnapshots) await discoverFixtures(nextController.signal);
        await seedScores(preparedSnapshots ?? [], nextController.signal);
      } catch (error) {
        nextController.abort();
        controller = null;
        detachExternalAbort();
        detachExternalAbort = undefined;
        throw error;
      }

      let resolveConnected: (() => void) | undefined;
      const connected = new Promise<void>((resolve) => {
        resolveConnected = resolve;
      });
      loop = runWithReconnect(nextController.signal, () => resolveConnected?.()).catch(
        (error: unknown) => {
          if (nextController.signal.aborted) return;
          const terminalError =
            error instanceof Error ? error : new Error(String(error));
          console.error("TxLINE live client stopped after reconnect attempts", terminalError);
          resolveFailure?.(terminalError);
        },
      );
      const startupFailure = failure.then((error) => {
        throw error;
      });
      let rejectAborted: ((reason?: unknown) => void) | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAborted = reject;
      });
      const handleAbort = () => {
        rejectAborted?.(
          nextController.signal.reason ?? new DOMException("Aborted", "AbortError"),
        );
      };
      if (nextController.signal.aborted) handleAbort();
      else nextController.signal.addEventListener("abort", handleAbort, { once: true });
      try {
        await Promise.race([connected, startupFailure, aborted]);
      } finally {
        nextController.signal.removeEventListener("abort", handleAbort);
      }
    },
    waitForFailure() {
      return failure;
    },
    async stop() {
      controller?.abort();
      await loop?.catch(() => {});
      detachExternalAbort?.();
      detachExternalAbort = undefined;
      controller = null;
      loop = null;
      preparedSnapshots = null;
    },
  };
}
