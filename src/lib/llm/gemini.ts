// Gemini provider (MVP / public repos). Uses @google/genai structured output
// (responseJsonSchema) so the model is constrained to the assessment contract,
// with defensive parsing as a safety net. Model is env-configurable (default
// gemini-3-flash-preview; switch to the GA gemini-3.5-flash by setting GEMINI_MODEL).

import { GoogleGenAI } from "@google/genai";
import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import { validateAssessment } from "@/lib/llm/provider";
import type { LlmAssessment } from "@/lib/types";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { parseJsonLoose } from "@/lib/llm/json";
import { ASSESSMENT_JSON_SCHEMA } from "@/lib/llm/schema";
import { envNumber, llmTimeoutMs, withLlmTimeout } from "@/lib/llm/config";

export const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini" as const;
  readonly model: string;
  private client: GoogleGenAI;

  constructor(apiKey: string, model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL) {
    this.client = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async assess(input: LlmScoreInput, opts: AssessOptions = {}): Promise<LlmAssessment> {
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
      response = await this.client.models.generateContent({
        model: this.model,
        contents: user,
        config: {
          systemInstruction: system,
          temperature: envNumber("LLM_TEMPERATURE", 0.2),
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
    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini.");
    const um = response.usageMetadata;
    opts.onUsage?.({ inputTokens: um?.promptTokenCount, outputTokens: um?.candidatesTokenCount });
    return validateAssessment(parseJsonLoose(text));
  }
}
