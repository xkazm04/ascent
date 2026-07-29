// "PROMPT IN → MODEL TEXT OUT" against the SAME provider selection the scan pipeline uses.
//
// WHY THIS EXISTS: LLMProvider.assess() is shaped around one contract (LlmScoreInput → LlmAssessment).
// The non-scan surfaces — today Shared Org Memory's write-gate and reflection passes — need a single
// free-form judgment and own their own schema. Until now the only text seam in the codebase was
// runClaudePrompt (src/lib/llm/claude-cli.ts), which is LOCAL-DEV-ONLY, so every one of those surfaces
// was structurally dead in production.
//
// THIS IS NOT A SECOND PROVIDER PATH. It reuses `resolveProviderChoice()` + `providerAvailable()` (so
// "which provider, and is it usable here?" still has exactly ONE answer in this codebase), the shared
// env knobs from config.ts (temperature, max tokens, timeout, the AbortController lifecycle), and the
// same lazy-import discipline the providers use. What it does NOT reuse is the assessment prompt, the
// JSON schema, the token metering and the validateAssessment safety net — none of which apply to a
// caller that brings its own contract.
//
// SELECTION IS DELIBERATELY THE SAME RULE AS getProvider(), NOT A NEW ONE:
//   - an EXPLICIT LLM_PROVIDER wins; if that provider isn't available here, this returns null (the
//     caller degrades honestly) rather than silently substituting a provider the operator didn't pick;
//   - LLM_PROVIDER=auto/unset resolves to Gemini when a key is present, else null;
//   - LLM_PROVIDER=mock returns null. There is no deterministic "mock text" that would be honest to
//     hand a caller whose whole job is judgment — "no engine" is the truthful answer.
// Returning null is a first-class result: callers surface it as `llmUnavailable`.

import type { ProviderName } from "@/lib/types";
import { providerAvailable, resolveProviderChoice } from "@/lib/llm";
import { llmMaxTokens, llmTemperature, llmTimeoutMs, withLlmTimeout } from "@/lib/llm/config";
import { DEFAULT_GEMINI_MODEL } from "@/lib/llm/gemini";
import { DEFAULT_OPENAI_MODEL } from "@/lib/llm/openai";
import { DEFAULT_OPENROUTER_MODEL } from "@/lib/llm/openrouter";
import { DEFAULT_BEDROCK_MODEL, DEFAULT_BEDROCK_REGION } from "@/lib/llm/bedrock";

/** Same shape as the memory cores' injected `RunPrompt`, kept structural so neither side imports the other. */
export type TextRunner = (prompt: string, signal?: AbortSignal) => Promise<string>;

export interface ResolvedTextRunner {
  /** Which provider actually answers — reported to the user so "an LLM ran" names WHICH one. */
  engine: ProviderName;
  model: string;
  run: TextRunner;
}

export interface TextRunnerOptions {
  /**
   * Per-call timeout. An INTERACTIVE caller (a human waiting on a button) should pass something well
   * under the scan-sized default; the caller degrades to its own no-LLM path when this fires.
   */
  timeoutMs?: number;
}

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * The ONE OpenAI-compatible transport, shared by the `openai` (incl. Azure / vLLM / Ollama / LM Studio)
 * and `openrouter` selections — they speak the identical /chat/completions API, which is exactly why
 * openrouter.ts exists as a thin variant of openai.ts. No response_format is requested: a caller here
 * owns its own contract and every one of them repair-parses with parseJsonLoose anyway, so demanding
 * strict JSON would only add a failure mode for endpoints that don't implement it.
 */
async function openAiCompatibleText(args: {
  url: string;
  headers: Record<string, string>;
  model: string;
  prompt: string;
  label: string;
  maxTokensEnv: string;
  signal: AbortSignal;
}): Promise<string> {
  const res = await fetch(args.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...args.headers },
    body: JSON.stringify({
      model: args.model,
      temperature: llmTemperature(),
      max_tokens: llmMaxTokens(args.maxTokensEnv),
      messages: [{ role: "user", content: args.prompt }],
    }),
    signal: args.signal,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${args.label} request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error(`Empty response from ${args.label}.`);
  return text;
}

async function geminiText(model: string, apiKey: string, prompt: string, signal: AbortSignal): Promise<string> {
  const { GoogleGenAI } = await import("@google/genai");
  const response = await new GoogleGenAI({ apiKey }).models.generateContent({
    model,
    contents: prompt,
    config: { temperature: llmTemperature(), abortSignal: signal },
  });
  const text = response.text;
  if (!text) throw new Error("Empty response from Gemini.");
  return text;
}

async function bedrockText(model: string, region: string, prompt: string, signal: AbortSignal): Promise<string> {
  // Lazily imported exactly as BedrockProvider does, so the AWS SDK never loads on the other paths.
  const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
  const res = await new BedrockRuntimeClient({ region }).send(
    new ConverseCommand({
      modelId: model,
      messages: [{ role: "user", content: [{ text: prompt }] }],
      inferenceConfig: { temperature: llmTemperature(), maxTokens: llmMaxTokens("BEDROCK_MAX_TOKENS") },
    }),
    { abortSignal: signal },
  );
  const text = (res.output?.message?.content ?? []).map((p) => (p as { text?: string }).text ?? "").join("");
  if (!text) throw new Error("Empty response from Bedrock.");
  return text;
}

/** Wrap a raw call in the shared timeout/disconnect AbortController lifecycle (never leaks a listener). */
function withTimeout(
  label: string,
  timeoutMs: number,
  call: (signal: AbortSignal, prompt: string) => Promise<string>,
): TextRunner {
  return async (prompt, callerSignal) => {
    const { signal, clear } = withLlmTimeout(callerSignal, timeoutMs, `${label} request timed out.`);
    try {
      return await call(signal, prompt);
    } finally {
      clear();
    }
  };
}

/**
 * Resolve a text runner for the configured provider, or null when none is reachable here.
 *
 * `null` is expected, not exceptional: an unset/mock provider, a missing key, or a claude-cli selection
 * on a production host all mean "no engine". Callers must report that state to the user rather than
 * conflating it with "the model had nothing to say".
 */
export async function resolveTextRunner(
  opts: TextRunnerOptions = {},
): Promise<ResolvedTextRunner | null> {
  const timeoutMs = opts.timeoutMs ?? llmTimeoutMs();
  const choice = resolveProviderChoice();
  // `auto` (and an unset flag) follows getProvider(): Gemini when a key is present, else nothing.
  const name: ProviderName = choice === "auto" ? "gemini" : choice;
  if (!providerAvailable(name)) return null;

  switch (name) {
    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
      const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
      return {
        engine: "gemini",
        model,
        run: withTimeout("Gemini", timeoutMs, (signal, prompt) => geminiText(model, apiKey, prompt, signal)),
      };
    }
    case "openai": {
      const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
      const baseUrl = (process.env.OPENAI_BASE_URL || OPENAI_DEFAULT_BASE_URL).replace(/\/$/, "");
      return {
        engine: "openai",
        model,
        run: withTimeout("OpenAI", timeoutMs, (signal, prompt) =>
          openAiCompatibleText({
            url: `${baseUrl}/chat/completions`,
            headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
            model,
            prompt,
            label: "OpenAI",
            maxTokensEnv: "OPENAI_MAX_TOKENS",
            signal,
          }),
        ),
      };
    }
    case "openrouter": {
      const model = process.env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL;
      return {
        engine: "openrouter",
        model,
        run: withTimeout("OpenRouter", timeoutMs, (signal, prompt) =>
          openAiCompatibleText({
            url: `${OPENROUTER_BASE_URL}/chat/completions`,
            headers: {
              authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}`,
              // OpenRouter's requested app-attribution headers, mirroring OpenRouterProvider.
              "HTTP-Referer": "https://ascent.dev",
              "X-Title": "Ascent",
            },
            model,
            prompt,
            label: "OpenRouter",
            maxTokensEnv: "OPENROUTER_MAX_TOKENS",
            signal,
          }),
        ),
      };
    }
    case "bedrock": {
      const model = process.env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL;
      const region = process.env.BEDROCK_REGION || process.env.AWS_REGION || DEFAULT_BEDROCK_REGION;
      return {
        engine: "bedrock",
        model,
        run: withTimeout("Bedrock", timeoutMs, (signal, prompt) => bedrockText(model, region, prompt, signal)),
      };
    }
    case "claude-cli": {
      // The dynamic import lives INSIDE a `NODE_ENV !== "production"` block, not after a guard `throw`:
      // the production build inlines NODE_ENV, folds this to `false`, and prunes the block — import
      // included — dropping claude-cli.ts and its child_process.spawn from the Node File Trace. Same
      // trick as LazyClaudeCliProvider (index.ts) and the PGlite boot (instrumentation.ts). providerAvailable
      // already returned false in production, so this branch is unreachable there anyway; the shape is
      // what keeps the bundler from following the import. Do not "simplify" it.
      if (process.env.NODE_ENV !== "production") {
        const { runClaudePrompt } = await import("@/lib/llm/claude-cli");
        const model = process.env.CLAUDE_MODEL || "sonnet";
        return {
          engine: "claude-cli",
          model,
          // The CLI owns its own timeout (it spawns a process rather than issuing a request), so pass
          // it through instead of racing a second AbortController against it.
          run: (prompt, signal) => runClaudePrompt(prompt, { signal, timeoutMs }),
        };
      }
      return null;
    }
    default:
      // "mock" — see the header: there is no honest deterministic text for a judgment call.
      return null;
  }
}
