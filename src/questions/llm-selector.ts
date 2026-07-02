import { z } from "zod";
import type { FixtureStage } from "../db/schema";
import { selectDeterministicSecondaries } from "./generate";
import { secondaryBudget } from "./stage-budget";
import { TEMPLATES, TEMPLATE_IDS } from "./templates";
import type { BuiltQuestion, GenerationContext, TemplateId } from "./types";

/**
 * Background LLM selection of which secondary-card templates + wording
 * variant to use, constrained to the issue-4 template registry.
 *
 * Env-gated and OFF by default: only runs when both OPENROUTER_API_KEY and
 * LLM_SELECTOR=on are set (see .env.example). Never used for the winner
 * card. Never called from a request path — only from background question
 * generation (src/questions/generate.ts, the scheduler in
 * src/questions/scheduler.ts).
 *
 * The LLM never invents rule fields (stat keys, operator, comparison,
 * threshold): it only names a templateId + wordingVariant. All of those
 * fields are then derived by calling that template's own build(), the same
 * function the deterministic path uses — so an LLM response can never
 * produce a rule outside the registry, and team order/thresholds are always
 * the same stable-seeded values regardless of which path picked the
 * template (see src/questions/seed.ts).
 */

const SECONDARY_TEMPLATE_IDS: TemplateId[] = TEMPLATE_IDS.filter(
  (id) => TEMPLATES[id].tier !== "primary",
);

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_ATTEMPTS = 2; // one call + one retry

const llmSelectionSchema = z.object({
  templateId: z.enum(SECONDARY_TEMPLATE_IDS as [TemplateId, ...TemplateId[]]),
  wordingVariant: z.number().int().min(0),
});

const llmResponseSchema = z.object({
  selections: z.array(llmSelectionSchema).max(SECONDARY_TEMPLATE_IDS.length),
});

type LlmSelection = z.infer<typeof llmSelectionSchema>;

export type SelectorEnv = Partial<Record<"OPENROUTER_API_KEY" | "LLM_SELECTOR" | "OPENROUTER_MODEL", string>>;

/** OFF by default: both OPENROUTER_API_KEY and LLM_SELECTOR=on are required. */
export function isLlmSelectorEnabled(env: SelectorEnv = process.env): boolean {
  return Boolean(env.OPENROUTER_API_KEY) && env.LLM_SELECTOR === "on";
}

export type SelectionSource = "llm" | "fallback";

export type SelectQuestionsResult = {
  rules: BuiltQuestion[];
  source: SelectionSource;
};

export type SelectQuestionsOptions = {
  env?: SelectorEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  model?: string;
};

function eligibleSecondaryTemplateIds(ctx: GenerationContext): TemplateId[] {
  return SECONDARY_TEMPLATE_IDS.filter((id) => TEMPLATES[id].isAvailable(ctx));
}

/** Semantic checks beyond "is this JSON shape valid" — see module docstring. */
function validateSemantics(
  selections: LlmSelection[],
  ctx: GenerationContext,
  budget: number,
): string | null {
  if (selections.length > budget) {
    return `LLM selected ${selections.length} cards, over the stage budget of ${budget}`;
  }

  const seen = new Set<TemplateId>();
  for (const selection of selections) {
    if (seen.has(selection.templateId)) {
      return `duplicate template id ${selection.templateId}`;
    }
    seen.add(selection.templateId);

    const template = TEMPLATES[selection.templateId];
    if (!template.isAvailable(ctx)) {
      return `template ${selection.templateId} is unavailable for fixture ${ctx.fixtureId} (missing benchmark or unsupported combination)`;
    }
    if (selection.wordingVariant >= template.wordingVariantCount) {
      return `wordingVariant ${selection.wordingVariant} out of range for ${selection.templateId}`;
    }
  }

  return null;
}

function buildPrompt(ctx: GenerationContext, eligible: TemplateId[], budget: number): string {
  return [
    `Fixture ${ctx.fixtureId}: ${ctx.homeTeam} vs ${ctx.awayTeam}.`,
    `Choose up to ${budget} secondary question templates from this exact set: ${eligible.join(", ")}.`,
    `For each, also choose a wordingVariant index (0-based) supported by that template.`,
    `Respond as JSON: {"selections":[{"templateId":"...","wordingVariant":0}]}.`,
  ].join(" ");
}

type OpenRouterCallResult = {
  parsedContent: unknown;
  model: string | null;
  usage: unknown;
};

async function callOpenRouter(
  prompt: string,
  options: { apiKey: string; model: string; timeoutMs: number; fetchImpl: typeof fetch },
): Promise<OpenRouterCallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await options.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenRouter responded with status ${response.status}`);
    }

    const body = (await response.json()) as {
      model?: string;
      usage?: unknown;
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("OpenRouter response is missing choices[0].message.content");
    }

    return { parsedContent: JSON.parse(content), model: body.model ?? null, usage: body.usage };
  } finally {
    clearTimeout(timer);
  }
}

function logEvent(event: Record<string, unknown>): void {
  console.log(JSON.stringify(event));
}

/**
 * Selects the full question set for a fixture: the winner card (always
 * deterministic) plus secondary cards from the LLM when enabled, or the
 * deterministic fallback path when disabled, timed out, or invalid.
 */
export async function selectQuestions(
  ctx: GenerationContext,
  stage: FixtureStage,
  options: SelectQuestionsOptions = {},
): Promise<SelectQuestionsResult> {
  const winner = TEMPLATES.winner.build(ctx);
  const budget = secondaryBudget(stage);
  const env = options.env ?? process.env;

  const fallback = (): SelectQuestionsResult => ({
    rules: [winner, ...selectDeterministicSecondaries(ctx, budget)],
    source: "fallback",
  });

  if (!isLlmSelectorEnabled(env)) {
    return fallback();
  }

  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return fallback(); // isLlmSelectorEnabled already guarantees this, but keep the type narrow

  const model = options.model ?? env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const eligible = eligibleSecondaryTemplateIds(ctx);
  const prompt = buildPrompt(ctx, eligible, budget);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    let modelUsed: string | null = null;
    let usage: unknown;

    try {
      const result = await callOpenRouter(prompt, { apiKey, model, timeoutMs, fetchImpl });
      modelUsed = result.model;
      usage = result.usage;

      const parsed = llmResponseSchema.parse(result.parsedContent);
      const semanticError = validateSemantics(parsed.selections, ctx, budget);
      if (semanticError) throw new Error(semanticError);

      const secondaries = parsed.selections.map((selection) =>
        TEMPLATES[selection.templateId].build(ctx, selection.wordingVariant),
      );

      logEvent({
        fixtureId: ctx.fixtureId,
        attempt,
        latencyMs: Date.now() - startedAt,
        model: modelUsed,
        usage,
        fallbackUsed: false,
      });

      return { rules: [winner, ...secondaries], source: "llm" };
    } catch (error) {
      const validationError = error instanceof Error ? error.message : String(error);
      logEvent({
        fixtureId: ctx.fixtureId,
        attempt,
        latencyMs: Date.now() - startedAt,
        model: modelUsed,
        usage,
        validationError,
        fallbackUsed: attempt === MAX_ATTEMPTS,
      });
    }
  }

  return fallback();
}
