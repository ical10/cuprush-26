import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAuthorizedFetch,
  parseSseStream,
  readLiveConfig,
  sseEventsFromChunks,
  type SseFrame,
} from "./live-client";

async function readCapturedRaw(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/captured/${name}`, import.meta.url), "utf8");
}

async function* chunked(text: string, size = 7): AsyncGenerator<string> {
  for (let i = 0; i < text.length; i += size) {
    yield text.slice(i, i + size);
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readLiveConfig", () => {
  it("reads TXLINE_BASE_URL and TXLINE_API_KEY from the given env", () => {
    const config = readLiveConfig({
      TXLINE_BASE_URL: "https://txline.example.com",
      TXLINE_API_KEY: "secret",
    } as NodeJS.ProcessEnv);

    expect(config).toEqual({ baseUrl: "https://txline.example.com", apiKey: "secret" });
  });

  it("throws when TXLINE_BASE_URL is missing", () => {
    expect(() =>
      readLiveConfig({ TXLINE_API_KEY: "secret" } as NodeJS.ProcessEnv),
    ).toThrow(/TXLINE_BASE_URL/);
  });

  it("throws when TXLINE_API_KEY is missing", () => {
    expect(() =>
      readLiveConfig({ TXLINE_BASE_URL: "https://txline.example.com" } as NodeJS.ProcessEnv),
    ).toThrow(/TXLINE_API_KEY/);
  });

  it("strips a trailing /api from the base URL and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const config = readLiveConfig({
      TXLINE_BASE_URL: "https://txline.example.com/api",
      TXLINE_API_KEY: "secret",
    } as NodeJS.ProcessEnv);

    expect(config.baseUrl).toBe("https://txline.example.com");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("strips a trailing slash from the base URL", () => {
    const config = readLiveConfig({
      TXLINE_BASE_URL: "https://txline.example.com/",
      TXLINE_API_KEY: "secret",
    } as NodeJS.ProcessEnv);

    expect(config.baseUrl).toBe("https://txline.example.com");
  });
});

describe("parseSseStream", () => {
  it("splits frames on blank lines and captures data, event, and id", async () => {
    const frames = await collect(
      parseSseStream(chunked('data: {"a":1}\nevent: scores\nid: 42\n\ndata: {"b":2}\nevent: scores\n\n')),
    );

    expect(frames).toEqual<SseFrame[]>([
      { data: '{"a":1}', event: "scores", id: "42" },
      { data: '{"b":2}', event: "scores" },
    ]);
  });

  it("accumulates multi-line data fields with newline joins", async () => {
    const frames = await collect(parseSseStream(chunked("data: line one\ndata: line two\n\n")));

    expect(frames).toEqual<SseFrame[]>([{ data: "line one\nline two" }]);
  });

  it("skips comment lines starting with a colon", async () => {
    const frames = await collect(parseSseStream(chunked(": keepalive\ndata: x\n\n")));

    expect(frames).toEqual<SseFrame[]>([{ data: "x" }]);
  });

  it("handles CRLF line endings and reassembles frames across chunk boundaries", async () => {
    const frames = await collect(parseSseStream(chunked("data: hello\r\nevent: scores\r\n\r\n", 3)));

    expect(frames).toEqual<SseFrame[]>([{ data: "hello", event: "scores" }]);
  });

  it("discards an incomplete trailing frame that never saw its blank line", async () => {
    const frames = await collect(parseSseStream(chunked("data: complete\n\ndata: dangling\n")));

    expect(frames).toEqual<SseFrame[]>([{ data: "complete" }]);
  });

  it("does not emit a frame for event-only input without data", async () => {
    const frames = await collect(parseSseStream(chunked("event: heartbeat\n\n")));

    expect(frames).toEqual([]);
  });
});

describe("sseEventsFromChunks", () => {
  it("skips every heartbeat frame in the captured stream", async () => {
    const raw = await readCapturedRaw("scores-stream.raw");

    expect(await collect(sseEventsFromChunks(chunked(raw)))).toEqual([]);
  });

  it("yields parsed score events from the captured per-fixture stream", async () => {
    const raw = await readCapturedRaw("scores-updates-18193785.raw");

    const events = await collect(sseEventsFromChunks(chunked(raw)));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ FixtureId: 18193785, Seq: 0, Action: "coverage_update" });
    expect(events[1]).toMatchObject({ FixtureId: 18193785, Seq: 1, Action: "comment" });
  });

  it("skips frames whose data is not valid JSON", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const events = await collect(
      sseEventsFromChunks(chunked('data: not-json\nevent: scores\n\ndata: {"ok":true}\nevent: scores\n\n')),
    );

    expect(events).toEqual([{ ok: true }]);
    expect(error).toHaveBeenCalledOnce();
  });
});

describe("createAuthorizedFetch", () => {
  const config = { baseUrl: "https://txline.example.com", apiKey: "api-key-1" };

  type Call = { url: string; init: RequestInit | undefined };

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
  }

  function fetchStub(handler: (url: string, init?: RequestInit) => Response) {
    const calls: Call[] = [];
    const impl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return handler(url, init);
    });
    return { impl: impl as typeof fetch, calls };
  }

  it("mints a guest JWT once and sends both auth headers on every data call", async () => {
    const { impl, calls } = fetchStub((url) =>
      url.endsWith("/auth/guest/start") ? jsonResponse({ token: "jwt-1" }) : jsonResponse([]),
    );
    const authorizedFetch = createAuthorizedFetch(config, impl);

    await authorizedFetch("/api/fixtures/snapshot");
    await authorizedFetch("/api/scores/snapshot/18192996");

    expect(calls.map((call) => call.url)).toEqual([
      "https://txline.example.com/auth/guest/start",
      "https://txline.example.com/api/fixtures/snapshot",
      "https://txline.example.com/api/scores/snapshot/18192996",
    ]);
    expect(calls[0]?.init?.method).toBe("POST");
    for (const call of calls.slice(1)) {
      const headers = new Headers(call.init?.headers);
      expect(headers.get("authorization")).toBe("Bearer jwt-1");
      expect(headers.get("x-api-token")).toBe("api-key-1");
    }
  });

  it("sends the Accept header when asked for an event stream", async () => {
    const { impl, calls } = fetchStub((url) =>
      url.endsWith("/auth/guest/start") ? jsonResponse({ token: "jwt-1" }) : jsonResponse([]),
    );
    const authorizedFetch = createAuthorizedFetch(config, impl);

    await authorizedFetch("/api/scores/stream", { accept: "text/event-stream" });

    const headers = new Headers(calls.at(-1)?.init?.headers);
    expect(headers.get("accept")).toBe("text/event-stream");
  });

  it("re-mints the JWT once on a 401 and retries successfully", async () => {
    let minted = 0;
    const { impl, calls } = fetchStub((url, init) => {
      if (url.endsWith("/auth/guest/start")) {
        minted += 1;
        return jsonResponse({ token: `jwt-${minted}` });
      }
      const auth = new Headers(init?.headers).get("authorization");
      return auth === "Bearer jwt-2" ? jsonResponse([]) : jsonResponse({}, 401);
    });
    const authorizedFetch = createAuthorizedFetch(config, impl);

    const res = await authorizedFetch("/api/fixtures/snapshot");

    expect(res.status).toBe(200);
    expect(minted).toBe(2);
    expect(calls.map((call) => call.url)).toEqual([
      "https://txline.example.com/auth/guest/start",
      "https://txline.example.com/api/fixtures/snapshot",
      "https://txline.example.com/auth/guest/start",
      "https://txline.example.com/api/fixtures/snapshot",
    ]);
    const retryHeaders = new Headers(calls.at(-1)?.init?.headers);
    expect(retryHeaders.get("authorization")).toBe("Bearer jwt-2");
    expect(retryHeaders.get("x-api-token")).toBe("api-key-1");
  });

  it("throws when the retry after a re-mint is still unauthorized", async () => {
    const { impl } = fetchStub((url) =>
      url.endsWith("/auth/guest/start") ? jsonResponse({ token: "jwt-x" }) : jsonResponse({}, 401),
    );
    const authorizedFetch = createAuthorizedFetch(config, impl);

    await expect(authorizedFetch("/api/fixtures/snapshot")).rejects.toThrow(/unauthorized|401/i);
  });

  it("throws when minting the guest JWT fails", async () => {
    const { impl } = fetchStub(() => jsonResponse({}, 500));
    const authorizedFetch = createAuthorizedFetch(config, impl);

    await expect(authorizedFetch("/api/fixtures/snapshot")).rejects.toThrow(/guest/i);
  });

  it("reuses the minted JWT across sequential calls", async () => {
    let minted = 0;
    const { impl } = fetchStub((url) => {
      if (url.endsWith("/auth/guest/start")) {
        minted += 1;
        return jsonResponse({ token: "jwt-1" });
      }
      return jsonResponse([]);
    });
    const authorizedFetch = createAuthorizedFetch(config, impl);

    await authorizedFetch("/api/fixtures/snapshot");
    await authorizedFetch("/api/scores/stream");
    await authorizedFetch("/api/scores/snapshot/1");

    expect(minted).toBe(1);
  });
});
