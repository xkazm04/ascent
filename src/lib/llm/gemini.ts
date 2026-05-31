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

export const DEFAULT_GEMINI_MODEL = "gemini-3-flash-preview";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60_000;

/** Reject a promise if it doesn't settle within `ms` (so a hung LLM call falls back). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

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
    const response = await withTimeout(
      this.client.models.generateContent({
        model: this.model,
        contents: user,
        config: {
          systemInstruction: system,
          temperature: 0.2,
          responseMimeType: "application/json",
          // Constrain decoding to the assessment contract (the same JSON Schema
          // Bedrock forces as a tool). This makes a well-formed response the
          // contract, not the hope; parseJsonLoose + validateAssessment below
          // remain the safety net for anything that still slips through.
          responseJsonSchema: ASSESSMENT_JSON_SCHEMA,
          // Abort the request if the client disconnects, so an abandoned scan stops
          // waiting on (and reading from) the model instead of running to completion.
          abortSignal: opts.signal,
        },
      }),
      LLM_TIMEOUT_MS,
      "Gemini request timed out.",
    );
    const text = response.text;
    if (!text) throw new Error("Empty response from Gemini.");
    return validateAssessment(parseJsonLoose(text));
  }
}
