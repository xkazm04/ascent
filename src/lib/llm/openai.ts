// OpenAI / Azure-OpenAI / OpenAI-compatible provider (vLLM, Ollama, LM Studio, …) — the most-
// requested enterprise LLM, which the closed 4-way ProviderName union previously locked out of real
// scans entirely. Fetch-based (no SDK dependency added). Decodes against the STRICT json_schema
// derived from ASSESSMENT_JSON_SCHEMA (the same contract gemini/bedrock constrain to), with an
// automatic one-shot fallback to plain json_object for OpenAI-compatible targets that don't implement
// it — plus the shared assessment prompt + the validateAssessment safety net.
//
// Config: OPENAI_API_KEY (required), OPENAI_MODEL (default gpt-4o-mini), OPENAI_BASE_URL (override
// for Azure / self-hosted; default https://api.openai.com/v1). Select with LLM_PROVIDER=openai.

import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import { validateAssessment, isAssessmentUsable } from "@/lib/llm/provider";
import type { LlmAssessment } from "@/lib/types";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { parseJsonLoose } from "@/lib/llm/json";
import { llmMaxTokens, llmTemperature, llmTimeoutMs, withLlmTimeout } from "@/lib/llm/config";
import { assessmentResponseFormat, isResponseFormatRejection, JSON_OBJECT_RESPONSE_FORMAT } from "@/lib/llm/schema";

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
    const post = (responseFormat: unknown) =>
      fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          temperature: llmTemperature(),
          // Give the reply room to complete the multi-KB assessment JSON. The OpenAI-compatible self-
          // hosted targets this module supports (vLLM, Ollama, LM Studio) often default to a SMALL
          // completion cap (Ollama's num_predict ≈ 128), which truncates the JSON mid-object →
          // parseJsonLoose recovers nothing usable → isAssessmentUsable falls below coverage → the scan
          // silently degrades to the mock floor under the "openai" provider name. Bedrock sets a budget
          // explicitly and Gemini relies on a high native default; OpenAI alone set none. Mirror
          // BEDROCK_MAX_TOKENS with an env-overridable default. (llm-provider-abstraction #2)
          max_tokens: llmMaxTokens("OPENAI_MAX_TOKENS"),
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
      // Constrain the SHAPE, not just "is JSON" — the strict json_schema derived from
      // ASSESSMENT_JSON_SCHEMA. Not every OpenAI-compatible target implements it (older Azure
      // api-versions, some vLLM/Ollama builds), and those reject the REQUEST rather than answer badly,
      // so a rejection naming response_format retries ONCE on the previous json_object path. That keeps
      // the strict win for endpoints that support it without adding a new hard-failure mode.
      let res = await post(assessmentResponseFormat());
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (isResponseFormatRejection(res.status, body)) {
          console.warn(
            `[llm/openai] model "${this.model}" rejected strict json_schema decoding; ` +
              "retrying with json_object (shape is then prompt-enforced only).",
          );
          res = await post(JSON_OBJECT_RESPONSE_FORMAT);
        } else {
          throw new Error(`OpenAI request failed (${res.status}): ${body.slice(0, 200)}`);
        }
      }
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

      // The json_object FALLBACK path guarantees VALID JSON, not the assessment SHAPE, and even under
      // strict json_schema a non-conforming endpoint may ignore the constraint. An OpenAI-compatible
      // endpoint (vLLM / Ollama / LM Studio) can therefore still return parseable-but-wrong output —
      // this shape guard stays the outer net regardless of decode path. Guard the shape here so a
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
