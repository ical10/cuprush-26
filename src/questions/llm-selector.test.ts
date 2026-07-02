import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATES } from "./templates";
import { selectDeterministicSecondaries } from "./generate";
import { isLlmSelectorEnabled, selectQuestions } from "./llm-selector";
import type { GenerationContext } from "./types";

const ctx: GenerationContext = {
  fixtureId: "wc-2026-arg-fra",
  homeTeam: "Argentina",
  awayTeam: "France",
};

const enabledEnv = { OPENROUTER_API_KEY: "test-key", LLM_SELECTOR: "on" };

function openRouterResponse(selections: { templateId: string; wordingVariant: number }[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: "test/small-model",
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      choices: [{ message: { content: JSON.stringify({ selections }) } }],
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("isLlmSelectorEnabled", () => {
  it("is off when OPENROUTER_API_KEY is missing", () => {
    expect(isLlmSelectorEnabled({ LLM_SELECTOR: "on" })).toBe(false);
  });

  it("is off when LLM_SELECTOR is not 'on'", () => {
    expect(isLlmSelectorEnabled({ OPENROUTER_API_KEY: "key" })).toBe(false);
    expect(isLlmSelectorEnabled({ OPENROUTER_API_KEY: "key", LLM_SELECTOR: "off" })).toBe(false);
  });

  it("is on only when both are set", () => {
    expect(isLlmSelectorEnabled(enabledEnv)).toBe(true);
  });
});

describe("selectQuestions", () => {
  it("never calls fetch when the selector is disabled (off by default)", async () => {
    const fetchImpl = vi.fn();
    const result = await selectQuestions(ctx, "early_knockout", {
      env: {},
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.source).toBe("fallback");
  });

  it("the winner card never comes from the LLM, enabled or not", async () => {
    const disabled = await selectQuestions(ctx, "group", { env: {} });
    const fetchImpl = vi.fn().mockResolvedValue(
      openRouterResponse([{ templateId: "corners_intra", wordingVariant: 0 }]),
    );
    const enabled = await selectQuestions(ctx, "group", { env: enabledEnv, fetchImpl });

    expect(disabled.rules[0]).toEqual(TEMPLATES.winner.build(ctx));
    expect(enabled.rules[0]).toEqual(TEMPLATES.winner.build(ctx));
  });

  it("accepts a valid, in-schema LLM response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      openRouterResponse([{ templateId: "corners_intra", wordingVariant: 1 }]),
    );

    const result = await selectQuestions(ctx, "group", { env: enabledEnv, fetchImpl });

    expect(result.source).toBe("llm");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.rules).toHaveLength(2);
    expect(result.rules[1]?.templateId).toBe("corners_intra");
    expect(result.rules[1]?.wordingVariant).toBe(1);
  });

  it("falls back to the deterministic path when the response fails schema validation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      openRouterResponse([{ templateId: "not_a_real_template", wordingVariant: 0 }]),
    );

    const result = await selectQuestions(ctx, "group", { env: enabledEnv, fetchImpl });

    expect(result.source).toBe("fallback");
    // Retries once before falling back.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.rules.slice(1)).toEqual(selectDeterministicSecondaries(ctx, 1));
  });

  it("falls back when the LLM picks a template that fails a semantic check (unavailable benchmark)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      openRouterResponse([{ templateId: "corners_inter_benchmark", wordingVariant: 0 }]),
    );

    // ctx has no benchmarkFixture, so corners_inter_benchmark is in-schema
    // (a real template id) but semantically unavailable here.
    const result = await selectQuestions(ctx, "group", { env: enabledEnv, fetchImpl });

    expect(result.source).toBe("fallback");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back when a wording variant index is out of range for its template", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      openRouterResponse([{ templateId: "corners_intra", wordingVariant: 99 }]),
    );

    const result = await selectQuestions(ctx, "group", { env: enabledEnv, fetchImpl });

    expect(result.source).toBe("fallback");
  });

  it("falls back when the selection exceeds the stage's secondary budget", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      openRouterResponse([
        { templateId: "corners_intra", wordingVariant: 0 },
        { templateId: "goals_exact_margin", wordingVariant: 0 },
      ]),
    );

    // group stage budget is 1 secondary card; 2 selections is over budget.
    const result = await selectQuestions(ctx, "group", { env: enabledEnv, fetchImpl });

    expect(result.source).toBe("fallback");
  });

  it("falls back after a timeout, retrying once first", async () => {
    const hangingFetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const result = await selectQuestions(ctx, "group", {
      env: enabledEnv,
      fetchImpl: hangingFetch as unknown as typeof fetch,
      timeoutMs: 10,
    });

    expect(result.source).toBe("fallback");
    expect(hangingFetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to the deterministic path on a non-2xx response, after one retry", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const result = await selectQuestions(ctx, "group", { env: enabledEnv, fetchImpl });

    expect(result.source).toBe("fallback");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never makes a real network call in tests (fetchImpl is always supplied or absent)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => {
      throw new Error("real fetch should never be invoked in tests");
    }));

    const result = await selectQuestions(ctx, "group", { env: {} });
    expect(result.source).toBe("fallback");
  });

  it("produces the identical seeded team order whether the LLM or the fallback path selects the same template", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      openRouterResponse([{ templateId: "corners_intra", wordingVariant: 0 }]),
    );

    const llmResult = await selectQuestions(ctx, "group", { env: enabledEnv, fetchImpl });
    const fallbackResult = await selectQuestions(ctx, "group", { env: {} });

    const llmCorners = llmResult.rules.find((r) => r.templateId === "corners_intra");
    const fallbackCorners = fallbackResult.rules.find((r) => r.templateId === "corners_intra");

    expect(llmCorners?.rule.statKey1).toBe(fallbackCorners?.rule.statKey1);
    expect(llmCorners?.rule.statKey2).toBe(fallbackCorners?.rule.statKey2);
  });

  it("logs latency, model, token usage and fallback status without throwing", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn().mockResolvedValue(
      openRouterResponse([{ templateId: "corners_intra", wordingVariant: 0 }]),
    );

    await selectQuestions(ctx, "group", { env: enabledEnv, fetchImpl });

    expect(logSpy).toHaveBeenCalled();
    const logged = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(logged).toMatchObject({ fallbackUsed: false, model: "test/small-model" });
    expect(typeof logged.latencyMs).toBe("number");
  });
});
