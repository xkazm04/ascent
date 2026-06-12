// AWS Bedrock provider — the privacy-preserving path for enterprise / private repos
// (Phase 2). Inference runs inside the customer's AWS account/region; Bedrock does not
// train on the data and does not share it with model providers. See docs/ARCHITECTURE.
//
// Default model is the latest Claude Sonnet (4.6) via the US geo inference profile, so
// data stays in-US while still being available in us-east-1 (where 4.6 has no in-Region
// endpoint). Override with BEDROCK_MODEL_ID / BEDROCK_REGION:
//   - global.anthropic.claude-sonnet-4-6  (max throughput, no residency constraint)
//   - eu.anthropic.claude-sonnet-4-6      (EU data residency)
//   - anthropic.claude-sonnet-4-6         (in-Region, where supported)
//
// The AWS SDK is imported lazily so the Gemini/mock paths never load it.

import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import { validateAssessment } from "@/lib/llm/provider";
import type { LlmAssessment } from "@/lib/types";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { parseJsonLoose } from "@/lib/llm/json";
import {
  ASSESSMENT_JSON_SCHEMA,
  ASSESSMENT_TOOL_DESCRIPTION,
  ASSESSMENT_TOOL_NAME,
} from "@/lib/llm/schema";
import { envNumber } from "@/lib/llm/config";

export const DEFAULT_BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-6";
export const DEFAULT_BEDROCK_REGION = "us-east-1";
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60_000;

export class BedrockProvider implements LLMProvider {
  readonly name = "bedrock" as const;
  readonly model: string;
  readonly region: string;

  constructor(opts: { model?: string; region?: string } = {}) {
    this.model = opts.model || process.env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL;
    this.region =
      opts.region ||
      process.env.BEDROCK_REGION ||
      process.env.AWS_REGION ||
      DEFAULT_BEDROCK_REGION;
  }

  async assess(input: LlmScoreInput, opts: AssessOptions = {}): Promise<LlmAssessment> {
    const { BedrockRuntimeClient, ConverseCommand } = await import(
      "@aws-sdk/client-bedrock-runtime"
    );
    const client = new BedrockRuntimeClient({ region: this.region });
    const { system, user } = buildAssessmentPrompt(input);

    // Per-call timeout via AbortController (the W6-2 pattern shared with gemini/openai): a hung
    // Converse call must be CANCELLED at LLM_TIMEOUT_MS, not left to run until scan.ts's 90s
    // total budget expires — Bedrock was the only provider without one, so a single hang ate the
    // whole budget and structurally starved the retry + LLM_FALLBACK_PROVIDER steps for the
    // enterprise path (straight to mock), while the open request kept billing for the extra 30s.
    // Combined with the client-disconnect signal so either one cancels the call.
    const timeoutCtrl = new AbortController();
    const timer = setTimeout(
      () => timeoutCtrl.abort(new Error("Bedrock request timed out.")),
      LLM_TIMEOUT_MS,
    );
    const abortSignal = opts.signal
      ? AbortSignal.any([opts.signal, timeoutCtrl.signal])
      : timeoutCtrl.signal;

    let res;
    try {
      res = await client.send(
        new ConverseCommand({
          modelId: this.model,
          system: [{ text: system }],
          messages: [{ role: "user", content: [{ text: user }] }],
          inferenceConfig: {
            temperature: envNumber("LLM_TEMPERATURE", 0.2),
            maxTokens: Math.round(envNumber("BEDROCK_MAX_TOKENS", 4096)),
          },
          // Force schema-constrained JSON via a single required tool (Converse
          // function-calling). The model must answer by calling this tool, whose
          // input schema is the same source of truth Gemini uses.
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: ASSESSMENT_TOOL_NAME,
                  description: ASSESSMENT_TOOL_DESCRIPTION,
                  inputSchema: { json: ASSESSMENT_JSON_SCHEMA },
                },
              },
            ],
            toolChoice: { tool: { name: ASSESSMENT_TOOL_NAME } },
          },
        }),
        // Abort the in-flight Bedrock call on client disconnect OR our own timeout.
        { abortSignal },
      );
    } finally {
      clearTimeout(timer);
    }

    opts.onUsage?.({ inputTokens: res.usage?.inputTokens, outputTokens: res.usage?.outputTokens });
    const blocks = res.output?.message?.content ?? [];

    // Happy path: the assessment comes back as a structured toolUse.input object
    // (already parsed) — no text extraction or JSON repair needed.
    for (const part of blocks) {
      const input = (part as { toolUse?: { input?: unknown } }).toolUse?.input;
      // Some models/regions/SDK paths surface the tool input as a JSON STRING rather than a parsed
      // object. validateAssessment(string) would coerce to a zero-dimension assessment, so the scan
      // silently degrades to mock — masking that Bedrock actually answered. Repair-parse a string
      // first; only short-circuit on a real (object) input, else fall through to the text path.
      if (typeof input === "string" && input.trim()) {
        // parseJsonLoose THROWS on a truncated/malformed tool-input string (observed on long Converse
        // responses). A throw here escapes the whole loop and skips the text-path safety net below,
        // degrading a recoverable answer to the mock floor — the opposite of "fall through to the text
        // path." Swallow the repair failure so the text block still gets a chance.
        try {
          return validateAssessment(parseJsonLoose(input));
        } catch {
          /* malformed tool-input string — fall through to the text path */
        }
      }
      if (input && typeof input === "object") return validateAssessment(input);
    }

    // Safety net: a model/region that ignores forced tool use may still answer
    // with text — fall back to tolerant parsing.
    const text = blocks.map((part) => (part as { text?: string }).text ?? "").join("");
    if (!text) throw new Error("Empty response from Bedrock.");
    return validateAssessment(parseJsonLoose(text));
  }
}
