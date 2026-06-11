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
import { OpenAiProvider } from "@/lib/llm/openai";
import { MockProvider } from "@/lib/llm/mock";

export type ProviderChoice = "auto" | ProviderName;

export function hasLlmKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

export function resolveProviderChoice(): ProviderChoice {
  const v = (process.env.LLM_PROVIDER ?? "auto").toLowerCase();
  return (["auto", "gemini", "bedrock", "openai", "mock", "claude-cli"] as const).includes(
    v as ProviderChoice,
  )
    ? (v as ProviderChoice)
    : "auto";
}

function geminiOrMock(): LLMProvider {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  return key ? new GeminiProvider(key) : new MockProvider();
}

/**
 * Cheap, synchronous prerequisite check so a misconfigured provider degrades to mock (in the picker)
 * or is skipped (in the failover) INSTEAD of spending the full retry/failover budget proving the
 * obvious. Only Gemini had the "construct mock when the prerequisite is absent" shortcut; bedrock,
 * openai, and claude-cli trusted that selecting them implied their prerequisites existed — so e.g. a
 * `bedrock → openai` failover would pick a keyless OpenAiProvider and waste a guaranteed-failing round
 * trip, and `LLM_PROVIDER=claude-cli` accidentally deployed to Vercel burned every plan step before
 * the inevitable mock. Construction is side-effect-free; this just gates it on env presence.
 */
export function providerAvailable(name: ProviderName): boolean {
  switch (name) {
    case "gemini":
      return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY);
    case "bedrock":
      // BedrockProvider ALWAYS resolves a region (BEDROCK_REGION > AWS_REGION > the us-east-1
      // default), so region is never a hard prerequisite — this sniffs for ANY sign the host is
      // wired for AWS (its own documented BEDROCK_REGION knob, a generic region, or a credential
      // signal incl. profile/role/container creds). Checking only AWS_REGION false-negatived
      // correctly-configured deploys (BEDROCK_REGION-only, key-only) into a silent mock degrade.
      return Boolean(
        process.env.BEDROCK_REGION ||
          process.env.AWS_REGION ||
          process.env.AWS_DEFAULT_REGION ||
          process.env.AWS_ACCESS_KEY_ID ||
          process.env.AWS_PROFILE ||
          process.env.AWS_ROLE_ARN ||
          process.env.AWS_WEB_IDENTITY_TOKEN_FILE ||
          process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
          process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI,
      );
    case "claude-cli":
      // Local-only by design; the `claude` binary can't be cheaply verified synchronously, but it
      // definitely can't run on Vercel — guard that named misconfiguration. Elsewhere trust the
      // operator's explicit LLM_PROVIDER=claude-cli (a missing binary still fails fast on spawn error).
      return !process.env.VERCEL;
    case "mock":
      return true;
    default:
      return false;
  }
}

export function getProvider(opts: { forceMock?: boolean } = {}): LLMProvider {
  if (opts.forceMock) return new MockProvider();
  const choice = resolveProviderChoice();
  // A selected-but-unavailable real provider pre-degrades to mock (logged so the misconfig is visible),
  // rather than the orchestrator discovering it the slow way across the whole retry/failover plan.
  const orMockIf = (available: boolean, make: () => LLMProvider, why: string): LLMProvider => {
    if (available) return make();
    console.warn(`[llm] LLM_PROVIDER=${choice} but ${why} — using mock`);
    return new MockProvider();
  };
  switch (choice) {
    case "mock":
      return new MockProvider();
    case "bedrock":
      // Trust the operator's EXPLICIT LLM_PROVIDER=bedrock (same stance as claude-cli): region
      // always resolves inside BedrockProvider, and credentials may be ambient (EC2/ECS role) —
      // invisible to any cheap env sniff. Pre-degrading here set intendedProvider="mock", which
      // suppressed the llmFailed warning entirely, so a falsely-gated healthy deploy served mock
      // scores with no caveat. A genuinely broken config still fails fast at assess() and the
      // retry → failover → mock chain degrades WITH the honest accounting. providerAvailable
      // still gates the implicit failover path in providerByName below.
      return new BedrockProvider();
    case "openai":
      return orMockIf(providerAvailable("openai"), () => new OpenAiProvider(), "OPENAI_API_KEY is unset");
    case "claude-cli":
      return orMockIf(providerAvailable("claude-cli"), () => new ClaudeCliProvider(), "the claude CLI isn't available here");
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
      return geminiOrMock(); // already returns mock without a key
    // A failover to an unavailable provider returns null so the orchestrator SKIPS the doomed attempt
    // (a keyless openai / region-less bedrock / CLI-less claude would otherwise waste a round trip
    // that always throws) and degrades to MockProvider itself.
    case "bedrock":
      return providerAvailable("bedrock") ? new BedrockProvider() : null;
    case "openai":
      return providerAvailable("openai") ? new OpenAiProvider() : null;
    case "claude-cli":
      return providerAvailable("claude-cli") ? new ClaudeCliProvider() : null;
    default:
      return null;
  }
}

export { MockProvider };
export type { LLMProvider };
