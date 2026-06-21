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

import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import type { LlmAssessment, ProviderName } from "@/lib/types";
import { GeminiProvider } from "@/lib/llm/gemini";
import { BedrockProvider } from "@/lib/llm/bedrock";
import { OpenAiProvider } from "@/lib/llm/openai";
import { MockProvider } from "@/lib/llm/mock";

export type ProviderChoice = "auto" | ProviderName;

/**
 * Lazy proxy for the claude-cli provider. It shells out via child_process to a local `claude` binary
 * (LOCAL-DEV-ONLY — assess() throws in any production build, which providerAvailable mirrors by gating
 * on NODE_ENV !== "production" so the failover skips it instead of selecting a guaranteed-throw provider).
 * Two things matter here:
 *  1. The dynamic import defers loading claude-cli.ts until a scan actually runs under it.
 *  2. The `NODE_ENV === "production"` guard is statically inlined and folded by the production build, so
 *     the `await import` below becomes UNREACHABLE dead code — which drops claude-cli.ts (and its
 *     child_process.spawn, a "very dynamic require") from the Node File Trace. A plain dynamic import with
 *     a literal specifier is still followed by the tracer; only making it dead code removes it, the same
 *     trick src/instrumentation.ts uses for the dev-only PGlite boot. In dev it imports and runs normally.
 * name/model resolve synchronously so the scan pipeline can read them before the (lazy) assess().
 */
class LazyClaudeCliProvider implements LLMProvider {
  readonly name = "claude-cli" as const;
  readonly model: string;
  constructor(model?: string) {
    // The real default lives in claude-cli.ts (DEFAULT_CLAUDE_MODEL = "sonnet"); mirror it here rather
    // than import it, which would re-introduce the static dependency this proxy exists to avoid.
    this.model = model || process.env.CLAUDE_MODEL || "sonnet";
  }
  async assess(input: LlmScoreInput, opts?: AssessOptions): Promise<LlmAssessment> {
    // The dynamic import lives INSIDE this NODE_ENV !== "production" block (not after a guard `throw`)
    // on purpose: the production build inlines NODE_ENV, folds the condition to `false`, and prunes the
    // whole `if (false) { … }` block — import included — as dead code, dropping claude-cli.ts from the
    // file trace. An import placed after a `throw` is NOT pruned (Turbopack still follows it); only the
    // dead `if`-block form removes it. Same pattern as the PGlite gate in src/instrumentation.ts.
    if (process.env.NODE_ENV !== "production") {
      const { ClaudeCliProvider } = await import("@/lib/llm/claude-cli");
      return new ClaudeCliProvider(this.model).assess(input, opts);
    }
    // Dev-only by design; on Vercel the `claude` binary doesn't exist and the scan's failover → mock.
    throw new Error("claude-cli is a local-dev-only provider and is not available in production builds");
  }
}

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
      // BUG (llm-provider-abstraction #1): availability MUST use the SAME condition LazyClaudeCli
      // .assess() enforces. assess() throws whenever NODE_ENV === "production" (the dynamic import is
      // dead-code-pruned by the prod build), but this gate used to key on VERCEL — so a non-Vercel
      // production host (Docker/ECS/plain `next start`) reported available=true yet ALWAYS threw,
      // silently degrading every scan to mock and defeating the failover skip. Gate on the same
      // NODE_ENV signal so an unavailable claude-cli is correctly false-negatived (picker degrades to
      // mock cleanly, providerByName failover skips it) instead of selecting a guaranteed-throw provider.
      return process.env.NODE_ENV !== "production";
    case "mock":
      return true;
    default:
      return false;
  }
}

export function getProvider(opts: { forceMock?: boolean } = {}): LLMProvider {
  if (opts.forceMock) return new MockProvider();
  const choice = resolveProviderChoice();
  switch (choice) {
    case "mock":
      return new MockProvider();
    case "bedrock":
    case "openai":
    case "claude-cli":
      // Trust the operator's EXPLICIT LLM_PROVIDER selection. Pre-degrading a selected-but-unavailable
      // real provider to mock HERE set intendedProvider="mock" downstream, which suppressed the
      // llmFailed warning + the fallback SSE event entirely — so a misconfigured (or merely
      // env-sniff-false-negative) deploy served mock scores with NO caveat (success theater). A
      // genuinely broken config instead fails fast at assess(), and the retry → failover → mock chain
      // degrades WITH honest accounting. (providerAvailable still gates the implicit failover path in
      // providerByName below, so the failover never wastes a round trip on a doomed provider.)
      if (choice === "bedrock") return new BedrockProvider();
      if (choice === "openai") return new OpenAiProvider();
      return new LazyClaudeCliProvider();
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
    // A failover to an unavailable provider returns null so the orchestrator SKIPS the doomed attempt
    // (a keyless openai / region-less bedrock / CLI-less claude would otherwise waste a round trip
    // that always throws) and degrades to MockProvider itself. Gemini included: geminiOrMock()'s
    // keyless branch IS a MockProvider, which scan.ts would run as a "successful" failover step —
    // suppressing the llmFailed warning, the fallback SSE event, and the operator's error log while
    // serving deterministic-floor scores. Keyless-by-name must be null, per this function's contract.
    case "gemini":
      return providerAvailable("gemini") ? geminiOrMock() : null;
    case "bedrock":
      return providerAvailable("bedrock") ? new BedrockProvider() : null;
    case "openai":
      return providerAvailable("openai") ? new OpenAiProvider() : null;
    case "claude-cli":
      return providerAvailable("claude-cli") ? new LazyClaudeCliProvider() : null;
    default:
      return null;
  }
}

export { MockProvider };
export type { LLMProvider };
