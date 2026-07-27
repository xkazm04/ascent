// OpenRouter provider — one API key, hundreds of models behind an OpenAI-compatible endpoint. This is
// the fleet path: it lets an operator (and the model-quality bench, scripts/llm-matrix.mjs) run any
// vendor's model through a single key, which is what the model-comparison scorecard is measured on.
// Fetch-based; decodes against the STRICT json_schema derived from ASSESSMENT_JSON_SCHEMA (OpenRouter
// proxies OpenAI's response_format contract), with a one-shot fallback to json_object for upstreams
// that refuse it, plus the shared assessment prompt + the validateAssessment safety net — the same
// path as the OpenAI-compatible adapter (OpenRouter speaks the OpenAI /chat/completions API).
//
// Config: OPENROUTER_API_KEY (required), OPENROUTER_MODEL (default openai/gpt-4o-mini — OpenRouter
// models are always "vendor/model" slugs). Select with LLM_PROVIDER=openrouter. Attribution headers
// (HTTP-Referer / X-Title) are OpenRouter's requested convention for app identification.

import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import { validateAssessment, isAssessmentUsable } from "@/lib/llm/provider";
import type { LlmAssessment } from "@/lib/types";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { parseJsonLoose } from "@/lib/llm/json";
import { llmMaxTokens, llmTemperature, llmTimeoutMs, withLlmTimeout } from "@/lib/llm/config";
import { assessmentResponseFormat, isResponseFormatRejection, JSON_OBJECT_RESPONSE_FORMAT } from "@/lib/llm/schema";

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";
const BASE_URL = "https://openrouter.ai/api/v1";
const REFERER = "https://ascent.dev";
const TITLE = "Ascent";

export class OpenRouterProvider implements LLMProvider {
  readonly name = "openrouter" as const;
  readonly model: string;
  private apiKey: string;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";
    this.model = opts.model || process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
  }

  async assess(input: LlmScoreInput, opts: AssessOptions = {}): Promise<LlmAssessment> {
    if (!this.apiKey) throw new Error("OPENROUTER_API_KEY is not set.");
    const { system, user } = buildAssessmentPrompt(input);

    // Abort on client disconnect OR our own timeout, whichever fires first (shared helper owns the
    // timer/listener lifecycle so no listener leaks) — same as the openai/gemini/bedrock adapters.
    const { signal, clear } = withLlmTimeout(opts.signal, llmTimeoutMs(), "OpenRouter request timed out.");
    const post = (responseFormat: unknown) =>
      fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          // OpenRouter's requested app-attribution headers (surface in their dashboard/rankings).
          "HTTP-Referer": REFERER,
          "X-Title": TITLE,
        },
        body: JSON.stringify({
          model: this.model,
          // llmTemperature(), not an inlined envNumber("LLM_TEMPERATURE", …): that function is
          // documented as "the single source the real providers read", and the inline copy here
          // silently skipped its [0,2] clamp. (llm-provider-abstraction #3)
          temperature: llmTemperature(),
          // Give the reply room to complete the multi-KB assessment JSON (mirrors OPENAI_MAX_TOKENS);
          // a small completion cap truncates the JSON mid-object → parseJsonLoose recovers nothing →
          // the scan silently degrades to the mock floor under the "openrouter" name.
          max_tokens: llmMaxTokens("OPENROUTER_MAX_TOKENS"),
          response_format: responseFormat,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal,
        cache: "no-store",
      });
    try {
      // Constrain the SHAPE, not just "is JSON". This is the decode path the baked model matrix was
      // measured on: docs/LLM_MODEL_MATRIX.md attributes glm/deepseek/sonnet's low reliability to
      // json_object-only decoding, so a strict json_schema is the lever. OpenRouter fans out to many
      // upstreams and not all of them accept it — a rejection naming response_format retries ONCE on
      // the old json_object path so no model that worked before starts hard-failing.
      let res = await post(assessmentResponseFormat());
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (isResponseFormatRejection(res.status, body)) {
          console.warn(
            `[llm/openrouter] model "${this.model}" rejected strict json_schema decoding; ` +
              "retrying with json_object (shape is then prompt-enforced only).",
          );
          res = await post(JSON_OBJECT_RESPONSE_FORMAT);
        } else {
          throw new Error(`OpenRouter request failed (${res.status}): ${body.slice(0, 200)}`);
        }
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`OpenRouter request failed (${res.status}): ${body.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content;
      if (!text) throw new Error("Empty response from OpenRouter.");
      opts.onUsage?.({ inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens });

      // The json_object FALLBACK path guarantees VALID JSON, not the assessment SHAPE, and an upstream
      // can ignore even a strict schema — so an OpenRouter model can still return parseable-but-wrong
      // output on either path. This shape guard stays the outer net. Guard it so a wrong reply
      // surfaces as a clear LLM failure (which scan.ts logs + degrades-to-mock on) instead of being
      // coerced to an empty assessment that reads as a real (deterministic-floor) scan.
      const parsed = parseJsonLoose(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("OpenRouter returned JSON that is not an assessment object.");
      }
      const assessment = validateAssessment(parsed);
      if (!isAssessmentUsable(assessment, input.signals.length)) {
        console.warn(
          `[llm/openrouter] model "${this.model}" scored only ${assessment.dimensions.length}/${input.signals.length} ` +
            `dimensions — the scan will lean on deterministic signals. Verify the model honors JSON output.`,
        );
      }
      return assessment;
    } finally {
      clear();
    }
  }
}
