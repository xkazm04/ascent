// OpenAI / Azure-OpenAI / OpenAI-compatible provider (vLLM, Ollama, LM Studio, …) — the most-
// requested enterprise LLM, which the closed 4-way ProviderName union previously locked out of real
// scans entirely. Fetch-based (no SDK dependency added). Uses JSON mode (response_format:
// json_object) plus the shared assessment prompt + the validateAssessment safety net — the most
// portable path across OpenAI-compatible endpoints (not all support strict json_schema).
//
// Config: OPENAI_API_KEY (required), OPENAI_MODEL (default gpt-4o-mini), OPENAI_BASE_URL (override
// for Azure / self-hosted; default https://api.openai.com/v1). Select with LLM_PROVIDER=openai.

import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import { validateAssessment, isAssessmentUsable } from "@/lib/llm/provider";
import type { LlmAssessment } from "@/lib/types";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { parseJsonLoose } from "@/lib/llm/json";
import { envNumber, llmTimeoutMs, withLlmTimeout } from "@/lib/llm/config";

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_BASE_URL = "https://api.openai.com/v1";

export class OpenAiProvider implements LLMProvider {
  readonly name = "openai" as const;
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: { apiKey?: string; model?: string; baseUrl?: string } = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = opts.model || process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
    this.baseUrl = (opts.baseUrl || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  async assess(input: LlmScoreInput, opts: AssessOptions = {}): Promise<LlmAssessment> {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY is not set.");
    const { system, user } = buildAssessmentPrompt(input);

    // Abort on client disconnect OR our own timeout, whichever fires first — via the shared
    // withLlmTimeout helper (the AbortSignal.any form gemini/bedrock use), which composes the two
    // signals and owns the timer/listener lifecycle so no listener leaks. (Was a hand-rolled
    // addEventListener/removeEventListener pair.)
    const { signal, clear } = withLlmTimeout(opts.signal, llmTimeoutMs(), "OpenAI request timed out.");
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          temperature: envNumber("LLM_TEMPERATURE", 0.2),
          // Give the reply room to complete the multi-KB assessment JSON. The OpenAI-compatible self-
          // hosted targets this module supports (vLLM, Ollama, LM Studio) often default to a SMALL
          // completion cap (Ollama's num_predict ≈ 128), which truncates the JSON mid-object →
          // parseJsonLoose recovers nothing usable → isAssessmentUsable falls below coverage → the scan
          // silently degrades to the mock floor under the "openai" provider name. Bedrock sets a budget
          // explicitly and Gemini relies on a high native default; OpenAI alone set none. Mirror
          // BEDROCK_MAX_TOKENS with an env-overridable default. (llm-provider-abstraction #2)
          max_tokens: Math.round(envNumber("OPENAI_MAX_TOKENS", 4096)),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal,
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`OpenAI request failed (${res.status}): ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error("Empty response from OpenAI.");
      opts.onUsage?.({ inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens });

      // `response_format: json_object` guarantees VALID JSON, not the assessment SHAPE (unlike Gemini's
      // responseJsonSchema / Bedrock's forced tool schema). An OpenAI-compatible endpoint (vLLM / Ollama
      // / LM Studio) can therefore return parseable-but-wrong output. Guard the shape here so a
      // fundamentally wrong reply (a JSON string/number/array, or `{ "error": … }`) surfaces as a clear
      // LLM failure — which scan.ts logs and degrades-to-mock on — instead of validateAssessment silently
      // coercing it to an empty assessment that reads as a real (deterministic-floor) scan.
      const parsed = parseJsonLoose(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("OpenAI returned JSON that is not an assessment object.");
      }
      const assessment = validateAssessment(parsed);
      // A valid-but-thin object (few/no dimensions scored) will make the engine fall back to the
      // deterministic floor (isAssessmentUsable). Log WHY at the provider level so a BYO-OpenAI operator
      // can see their endpoint under-graded, rather than only inferring it from the "mock" engine chip.
      if (!isAssessmentUsable(assessment, input.signals.length)) {
        console.warn(
          `[llm/openai] model "${this.model}" scored only ${assessment.dimensions.length}/${input.signals.length} ` +
            `dimensions — the scan will lean on deterministic signals. Verify the endpoint honors JSON output.`,
        );
      }
      return assessment;
    } finally {
      clear();
    }
  }
}
