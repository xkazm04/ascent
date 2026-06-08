// Provider selection via the LLM_PROVIDER env flag.
//
//   LLM_PROVIDER=gemini   -> Gemini (local dev & testing default). Falls back to mock
//                            if no GEMINI_API_KEY is set.
//   LLM_PROVIDER=bedrock  -> AWS Bedrock / Claude Sonnet (Phase 2, enterprise privacy).
//   LLM_PROVIDER=mock     -> deterministic, keyless.
//   LLM_PROVIDER=auto     -> (default) Gemini if a key is present, else mock. Never
//                            silently selects Bedrock — that's opt-in via the flag.
//
// Keep Gemini local: set LLM_PROVIDER=gemini in .env.local. Switch to Bedrock in
// production by setting LLM_PROVIDER=bedrock + AWS credentials/region.

import type { LLMProvider } from "@/lib/llm/provider";
import type { ProviderName } from "@/lib/types";
import { GeminiProvider } from "@/lib/llm/gemini";
import { BedrockProvider } from "@/lib/llm/bedrock";
import { ClaudeCliProvider } from "@/lib/llm/claude-cli";
import { MockProvider } from "@/lib/llm/mock";

export type ProviderChoice = "auto" | ProviderName;

export function hasLlmKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

export function resolveProviderChoice(): ProviderChoice {
  const v = (process.env.LLM_PROVIDER ?? "auto").toLowerCase();
  return (["auto", "gemini", "bedrock", "mock", "claude-cli"] as const).includes(
    v as ProviderChoice,
  )
    ? (v as ProviderChoice)
    : "auto";
}

function geminiOrMock(): LLMProvider {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return key ? new GeminiProvider(key) : new MockProvider();
}

export function getProvider(opts: { forceMock?: boolean } = {}): LLMProvider {
  if (opts.forceMock) return new MockProvider();
  switch (resolveProviderChoice()) {
    case "mock":
      return new MockProvider();
    case "bedrock":
      return new BedrockProvider();
    case "claude-cli":
      return new ClaudeCliProvider();
    case "gemini":
      return geminiOrMock();
    case "auto":
    default:
      return geminiOrMock();
  }
}

/**
 * Construct a specific real provider by name — for the scan's `LLM_FALLBACK_PROVIDER` failover
 * (try a second model on a transient primary failure before degrading to the deterministic mock).
 * Returns null for "mock"/unknown/empty: those mean "no real fallback", and the caller degrades to
 * MockProvider itself. Construction is side-effect-free (no network until assess()).
 */
export function providerByName(name: string | undefined | null): LLMProvider | null {
  switch ((name ?? "").trim().toLowerCase()) {
    case "gemini":
      return geminiOrMock();
    case "bedrock":
      return new BedrockProvider();
    case "claude-cli":
      return new ClaudeCliProvider();
    default:
      return null;
  }
}

export { MockProvider };
export type { LLMProvider };
