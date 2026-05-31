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

export { MockProvider };
export type { LLMProvider };
