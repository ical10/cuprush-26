import { describe, expect, it } from "vitest";
import {
  applySelection,
  createReplayMetaFetcher,
  createReplayStatsFetcher,
  encodeReplayId,
  hasTxLineCreds,
  parseIdList,
  parseReplayId,
  parseReplayStage,
} from "./replay-source";

describe("replay id encode/parse", () => {
  it("round-trips a numeric source id and default counter", () => {
    const id = encodeReplayId("123456");
    expect(id).toBe("replay-123456-0");
    expect(parseReplayId(id)).toEqual({ sourceId: "123456", counter: 0 });
  });

  it("round-trips a non-zero re-replay counter", () => {
    const id = encodeReplayId("123456", 3);
    expect(id).toBe("replay-123456-3");
    expect(parseReplayId(id)).toEqual({ sourceId: "123456", counter: 3 });
  });

  it("recovers a source id that itself contains dashes", () => {
    const id = encodeReplayId("src-abc-def", 2);
    expect(id).toBe("replay-src-abc-def-2");
    expect(parseReplayId(id)).toEqual({ sourceId: "src-abc-def", counter: 2 });
  });

  it("rejects non-replay and malformed ids", () => {
    expect(parseReplayId("fixture-123")).toBeNull();
    expect(parseReplayId("replay-123")).toBeNull(); // no counter segment
    expect(parseReplayId("replay-123-x")).toBeNull(); // non-numeric counter
    expect(parseReplayId("replay--0")).toBeNull(); // empty source id
  });
});

describe("parseIdList", () => {
  it("returns null when unset or effectively empty", () => {
    expect(parseIdList(undefined)).toBeNull();
    expect(parseIdList("")).toBeNull();
    expect(parseIdList(" , ,")).toBeNull();
  });

  it("trims and drops empty tokens", () => {
    expect(parseIdList("a, b ,c,")).toEqual(["a", "b", "c"]);
  });
});

describe("applySelection", () => {
  const ids = ["10", "20", "30"];

  it("keeps all when include and exclude are null", () => {
    expect(applySelection(ids, null, null)).toEqual(["10", "20", "30"]);
  });

  it("keeps only included ids, preserving source order", () => {
    expect(applySelection(ids, ["30", "10"], null)).toEqual(["10", "30"]);
  });

  it("drops excluded ids after include", () => {
    expect(applySelection(ids, null, ["20"])).toEqual(["10", "30"]);
    expect(applySelection(ids, ["10", "20"], ["20"])).toEqual(["10"]);
  });

  it("throws on an include/exclude key matching no source id", () => {
    expect(() => applySelection(ids, ["99"], null)).toThrow(/unknown source id "99"/);
    expect(() => applySelection(ids, null, ["nope"])).toThrow(/unknown source id "nope"/);
  });
});

describe("parseReplayStage", () => {
  it("defaults to early_knockout", () => {
    expect(parseReplayStage({})).toBe("early_knockout");
    expect(parseReplayStage({ REPLAY_STAGE: "" })).toBe("early_knockout");
  });

  it("accepts valid stages", () => {
    expect(parseReplayStage({ REPLAY_STAGE: "semi_final" })).toBe("semi_final");
    expect(parseReplayStage({ REPLAY_STAGE: "final" })).toBe("final");
  });

  it("throws on an invalid stage", () => {
    expect(() => parseReplayStage({ REPLAY_STAGE: "quarter" })).toThrow(/REPLAY_STAGE/);
  });
});

describe("hasTxLineCreds", () => {
  it("is true only with both base url and api key", () => {
    expect(hasTxLineCreds({})).toBe(false);
    expect(hasTxLineCreds({ TXLINE_BASE_URL: "https://x" })).toBe(false);
    expect(hasTxLineCreds({ TXLINE_API_KEY: "k" })).toBe(false);
    expect(hasTxLineCreds({ TXLINE_BASE_URL: "https://x", TXLINE_API_KEY: "k" })).toBe(true);
  });
});

describe("createReplayStatsFetcher", () => {
  const creds = { TXLINE_BASE_URL: "https://txline.test", TXLINE_API_KEY: "key" };

  const scoreEvents = [
    {
      FixtureId: 999,
      Seq: 1,
      Ts: 1000,
      Action: "goal",
      Participant1IsHome: true,
      Score: {
        Participant1: { Total: { Goals: 1 } },
        Participant2: { Total: { Goals: 0 } },
      },
    },
    {
      FixtureId: 999,
      Seq: 3,
      Ts: 3000,
      Action: "game_finalised",
      Participant1IsHome: true,
      Score: {
        Participant1: { Total: { Goals: 2, Corners: 5 }, H1: { Goals: 1 } },
        Participant2: { Total: { Goals: 1, Corners: 3 } },
      },
    },
  ];

  function fakeFetch(body: unknown, status = 200): typeof fetch {
    return (async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/auth/guest/start")) {
        return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
      }
      return new Response(JSON.stringify(body), { status });
    }) as typeof fetch;
  }

  it("returns null when creds are absent", () => {
    expect(createReplayStatsFetcher({})).toBeNull();
  });

  it("returns the max-Seq event's cumulative stats and seq", async () => {
    const fetcher = createReplayStatsFetcher(creds, fakeFetch(scoreEvents));
    expect(fetcher).not.toBeNull();
    const { stats, lastSeq } = await fetcher!("999");

    expect(lastSeq).toBe(3);
    expect(stats.full_time?.home.goals).toBe(2);
    expect(stats.full_time?.home.corners).toBe(5);
    expect(stats.full_time?.away.goals).toBe(1);
    expect(stats.first_half?.home.goals).toBe(1);
  });

  it("throws when the snapshot has no score events", async () => {
    const fetcher = createReplayStatsFetcher(creds, fakeFetch([]));
    await expect(fetcher!("999")).rejects.toThrow(/no score events/);
  });

  it("throws on a non-ok response", async () => {
    const fetcher = createReplayStatsFetcher(creds, fakeFetch({}, 500));
    await expect(fetcher!("999")).rejects.toThrow(/scores snapshot failed/);
  });
});

describe("createReplayMetaFetcher", () => {
  const creds = {
    TXLINE_BASE_URL: "https://txline.test",
    TXLINE_API_KEY: "key",
    REPLAY_START_EPOCH_DAY: "20639",
  };

  // Raw wire (PascalCase) fixtures snapshot, as the API returns it.
  const wireSnapshot = [
    {
      FixtureId: 555,
      StartTime: 1_700_000_000_000,
      Participant1: "Spain",
      Participant2: "France",
      Participant1IsHome: false,
      Competition: "World Cup",
      CompetitionId: 72,
    },
  ];

  function fakeFetch(capture: { url?: string }): typeof fetch {
    return (async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.endsWith("/auth/guest/start")) {
        return new Response(JSON.stringify({ token: "jwt" }), { status: 200 });
      }
      capture.url = url;
      return new Response(JSON.stringify(wireSnapshot), { status: 200 });
    }) as typeof fetch;
  }

  it("throws when the epoch day is missing", () => {
    expect(() =>
      createReplayMetaFetcher({ TXLINE_BASE_URL: "https://x", TXLINE_API_KEY: "k" }),
    ).toThrow(/REPLAY_START_EPOCH_DAY/);
  });

  it("queries the windowed snapshot and normalizes home/away", async () => {
    const capture: { url?: string } = {};
    const fetcher = createReplayMetaFetcher(creds, fakeFetch(capture));
    const list = await fetcher();

    expect(capture.url).toContain("startEpochDay=20639");
    expect(capture.url).toContain("competitionId=72");
    expect(list).toHaveLength(1);
    // Participant1IsHome=false → France is home, Spain away.
    expect(list[0]!.fixtureId).toBe("555");
    expect(list[0]!.homeTeam).toBe("France");
    expect(list[0]!.awayTeam).toBe("Spain");
  });
});
