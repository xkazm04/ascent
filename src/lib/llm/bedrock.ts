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
import { envNumber, llmTimeoutMs, thinkingBudgetTokens } from "@/lib/llm/config";

export const DEFAULT_BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-6";
export const DEFAULT_BEDROCK_REGION = "us-east-1";

/** Static AWS credentials for the BYOM path (Feature 1). Omitted = the default AWS credential chain
 *  (env / role / metadata), i.e. the platform's own Bedrock account. */
export interface BedrockCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export class BedrockProvider implements LLMProvider {
  readonly name = "bedrock" as const;
  readonly model: string;
  readonly region: string;
  /** BYOM: when set, the SDK client authenticates with THESE org-supplied creds instead of the default
   *  chain — so inference runs in the org's AWS account. Never logged. */
  private readonly credentials?: BedrockCredentials;

  constructor(opts: { model?: string; region?: string; credentials?: BedrockCredentials } = {}) {
    this.model = opts.model || process.env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL;
    this.region =
      opts.region ||
      process.env.BEDROCK_REGION ||
      process.env.AWS_REGION ||
      DEFAULT_BEDROCK_REGION;
    this.credentials = opts.credentials;
  }

  async assess(input: LlmScoreInput, opts: AssessOptions = {}): Promise<LlmAssessment> {
    const { BedrockRuntimeClient, ConverseCommand } = await import(
      "@aws-sdk/client-bedrock-runtime"
    );
    // Pass injected BYOM creds when present; otherwise the SDK uses the default chain (platform account).
    const client = new BedrockRuntimeClient({
      region: this.region,
      ...(this.credentials ? { credentials: this.credentials } : {}),
    });
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
      llmTimeoutMs(),
    );
    const abortSignal = opts.signal
      ? AbortSignal.any([opts.signal, timeoutCtrl.signal])
      : timeoutCtrl.signal;

    // Extended-thinking budget (opt-in via LLM_THINKING_BUDGET — Tiger P2-6c; default 0 = off, no change).
    // When on, the model needs maxTokens ABOVE the reasoning budget to still have room for the answer.
    const thinking = thinkingBudgetTokens();
    const baseMaxTokens = Math.round(envNumber("BEDROCK_MAX_TOKENS", 4096));
    const maxTokens = thinking > 0 ? Math.max(baseMaxTokens, thinking + 1024) : baseMaxTokens;

    let res;
    try {
      res = await client.send(
        new ConverseCommand({
          modelId: this.model,
          // Cache the stable system prefix (role + rubric + task + schema — identical every scan; the
          // bulk of the input tokens). The cachePoint marks the breakpoint; re-scans with the same
          // prefix get a cache READ at a fraction of the input price, while the per-repo user message
          // is always fresh. Supported on the Claude-on-Bedrock models this app defaults to. [Tiger P0-1]
          system: [{ text: system }, { cachePoint: { type: "default" } }],
          messages: [{ role: "user", content: [{ text: user }] }],
          inferenceConfig: {
            // Extended thinking requires temperature 1; otherwise honor the configured determinism knob.
            temperature: thinking > 0 ? 1 : envNumber("LLM_TEMPERATURE", 0.2),
            maxTokens,
          },
          // Enable extended thinking when budgeted. It is INCOMPATIBLE with forced tool choice, so when
          // on we let tool choice be auto (the text-path safety net below still parses a non-tool answer).
          ...(thinking > 0
            ? { additionalModelRequestFields: { thinking: { type: "enabled", budget_tokens: thinking } } }
            : {}),
          // Force schema-constrained JSON via a single required tool (Converse
          // function-calling). The model must answer by calling this tool, whose
          // input schema is the same source of truth Gemini uses. (Relaxed to auto when thinking is on.)
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
            toolChoice: thinking > 0 ? { auto: {} } : { tool: { name: ASSESSMENT_TOOL_NAME } },
          },
        }),
        // Abort the in-flight Bedrock call on client disconnect OR our own timeout.
        { abortSignal },
      );
    } finally {
      clearTimeout(timer);
    }

    // Meter the full prompt-cache breakdown (Tiger P1-6): inputTokens is the FRESH input; cache reads
    // (~10% rate) and writes (~125%) are separate classes billableInputTokens() folds into the cost basis.
    opts.onUsage?.({
      inputTokens: res.usage?.inputTokens,
      outputTokens: res.usage?.outputTokens,
      cacheReadTokens: res.usage?.cacheReadInputTokens,
      cacheWriteTokens: res.usage?.cacheWriteInputTokens,
    });
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

/**
 * One cheap Bedrock call to validate a BYOM connection (Feature 1, the test-connection endpoint) —
 * sends a 1-token Converse "ping" with the supplied model/region/credentials. Returns { ok } on a
 * successful round trip, or { ok:false, error } with a sanitized message (never the credential). A
 * short timeout keeps the settings UI responsive.
 */
export async function testBedrockConnection(opts: {
  model?: string;
  region?: string;
  credentials?: BedrockCredentials;
}): Promise<{ ok: boolean; error?: string }> {
  const model = opts.model || process.env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL;
  const region = opts.region || process.env.BEDROCK_REGION || process.env.AWS_REGION || DEFAULT_BEDROCK_REGION;
  try {
    const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
    const client = new BedrockRuntimeClient({
      region,
      ...(opts.credentials ? { credentials: opts.credentials } : {}),
    });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("Bedrock test timed out.")), 15_000);
    try {
      await client.send(
        new ConverseCommand({
          modelId: model,
          messages: [{ role: "user", content: [{ text: "ping" }] }],
          inferenceConfig: { maxTokens: 1, temperature: 0 },
        }),
        { abortSignal: ctrl.signal },
      );
    } finally {
      clearTimeout(timer);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : "Bedrock connection failed.").slice(0, 300) };
  }
}
