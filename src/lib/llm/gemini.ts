// Gemini provider (MVP / public repos). Uses @google/genai structured output
// (responseJsonSchema) so the model is constrained to the assessment contract,
// with defensive parsing as a safety net. Model is env-configurable via GEMINI_MODEL.
//
// 2026-08-14: the default moved off `gemini-3-flash-preview` to the GA **gemini-3.7-flash**.
// The preview default was the open engine-credibility item in `tiger/` (P2-6): the PUBLIC tier — the
// one that produces the scores in the shared corpus and on the public leaderboard — was running an
// unbenchmarked preview model, so every externally-visible number rested on an engine nobody had
// certified. A GA model is the precondition for claiming any of those numbers externally; it does
// NOT by itself close P2-6, which needs the benchmark run.
//
// NOTE for the operator: this is a scoring-engine change. Cached scores are keyed on the model
// (see makeCacheKey / cache.ts), so existing entries do not silently re-serve under the new engine —
// an unchanged repo re-scores rather than reporting the preview model's number as current.

import { GoogleGenAI } from "@google/genai";
import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import { finalizeAssessment } from "@/lib/llm/provider";
import type { LlmAssessment } from "@/lib/types";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { ASSESSMENT_JSON_SCHEMA } from "@/lib/llm/schema";
import { llmTemperature, llmTimeoutMs, withLlmTimeout } from "@/lib/llm/config";

export const DEFAULT_GEMINI_MODEL = "gemini-3.7-flash";

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini" as const;
  readonly model: string;
  private readonly apiKey: string;
  // Constructed lazily on first assess() (not in the constructor) so construction is side-effect-free
  // and a keyless GeminiProvider can be CONSTRUCTED for an explicit LLM_PROVIDER=gemini selection, then
  // fail loudly at assess() — mirroring OpenAiProvider — instead of the picker pre-collapsing to mock.
  private client?: GoogleGenAI;

  constructor(apiKey: string, model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async assess(input: LlmScoreInput, opts: AssessOptions = {}): Promise<LlmAssessment> {
    // Fail LOUD on a missing/typo'd key rather than degrade silently. For an EXPLICIT gemini selection
    // (LLM_PROVIDER=gemini) index.ts constructs this provider unconditionally, so a keyless client must
    // throw here — scan.ts then logs the failure and degrades through the ACCOUNTED retry → failover →
    // mock chain (honest "Model unavailable"), not a MockProvider masquerading as gemini. Matches
    // OpenAiProvider's "OPENAI_API_KEY is not set" guard.
    if (!this.apiKey) throw new Error("GEMINI_API_KEY is not set.");
    const client = (this.client ??= new GoogleGenAI({ apiKey: this.apiKey }));
    const { system, user } = buildAssessmentPrompt(input);
    // Drive the timeout through an AbortController so a hung model request is actually CANCELLED
    // (frees the socket, stops token billing) — not merely abandoned by a promise race that left the
    // original call running in the background while retry/fallback fired (a retry storm that doubled
    // in-flight requests on every timeout). The shared helper combines it with the client-disconnect
    // signal so either one cancels the call.
    const { signal: abortSignal, clear } = withLlmTimeout(
      opts.signal,
      llmTimeoutMs(),
      "Gemini request timed out.",
    );
    let response;
    try {
      response = await client.models.generateContent({
        model: this.model,
        contents: user,
        config: {
          systemInstruction: system,
          temperature: llmTemperature(),
          responseMimeType: "application/json",
          // Constrain decoding to the assessment contract (the same JSON Schema Bedrock forces as a
          // tool); parseJsonLoose + validateAssessment below remain the safety net.
          responseJsonSchema: ASSESSMENT_JSON_SCHEMA,
          abortSignal,
        },
      });
    } finally {
      clear();
    }
    const um = response.usageMetadata;
    return finalizeAssessment(
      response.text,
      { inputTokens: um?.promptTokenCount, outputTokens: um?.candidatesTokenCount },
      opts,
      "Gemini",
    );
  }
}
