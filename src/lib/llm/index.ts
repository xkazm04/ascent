// Provider selection via the LLM_PROVIDER env flag.
//
//   LLM_PROVIDER=gemini     -> Gemini (local dev & testing default). Falls back to mock
//                              if no GEMINI_API_KEY is set.
//   LLM_PROVIDER=openai     -> OpenAI / Azure-OpenAI / OpenAI-compatible (vLLM, Ollama, …).
//   LLM_PROVIDER=openrouter -> OpenRouter (one key, any vendor's model — the fleet/bench path).
//   LLM_PROVIDER=bedrock    -> AWS Bedrock / Claude Sonnet (Phase 2, enterprise privacy).
//   LLM_PROVIDER=claude-cli -> local `claude` CLI under your subscription (LOCAL-DEV-ONLY;
//                              throws in production builds).
//   LLM_PROVIDER=mock       -> deterministic, keyless.
//   LLM_PROVIDER=auto       -> (default) Gemini if a key is present, else mock. Never
//                              silently selects Bedrock — that's opt-in via the flag.
//
// Keep Gemini local: set LLM_PROVIDER=gemini in .env.local. Switch to Bedrock in
// production by setting LLM_PROVIDER=bedrock + AWS credentials/region.

import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import type { LlmAssessment, ProviderName } from "@/lib/types";
import { GeminiProvider } from "@/lib/llm/gemini";
import { BedrockProvider } from "@/lib/llm/bedrock";
import { OpenAiProvider } from "@/lib/llm/openai";
import { OpenRouterProvider } from "@/lib/llm/openrouter";
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

const PROVIDER_CHOICES = ["auto", "gemini", "bedrock", "openai", "openrouter", "mock", "claude-cli"] as const;

export function resolveProviderChoice(): ProviderChoice {
  const raw = (process.env.LLM_PROVIDER ?? "").trim();
  if (!raw) return "auto";
  const v = raw.toLowerCase();
  if ((PROVIDER_CHOICES as readonly string[]).includes(v)) return v as ProviderChoice;
  // Fail LOUD on an unrecognized non-empty value instead of coercing it to "auto". The rest of this
  // module refuses to let an explicit-but-misconfigured selection degrade silently (see the bedrock/
  // openai/gemini branches in getProvider), yet a typo in the provider NAME itself — the most likely
  // operator error, e.g. LLM_PROVIDER=bedrok on an enterprise-privacy deploy — previously became
  // auto → Gemini-or-mock with zero signal, routing private source to a provider the operator never
  // chose. An unknown value is broken config, not absent config: refuse to guess.
  // (ambiguity-ui-scan-2026-07-16 llm-provider-abstraction #1)
  throw new Error(
    `Unknown LLM_PROVIDER "${raw}" — expected one of ${PROVIDER_CHOICES.join(", ")}. ` +
      `Refusing to fall back to "auto": a typo'd provider must fail loudly rather than silently ` +
      `route scans through a provider you did not choose. Fix or unset LLM_PROVIDER.`,
  );
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
    case "openrouter":
      return Boolean(process.env.OPENROUTER_API_KEY);
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
      // Mirror LazyClaudeCliProvider.assess(): it throws whenever NODE_ENV === "production" (the
      // dynamic import is dead-code-pruned by the prod build), so availability must gate on the SAME
      // NODE_ENV signal — not VERCEL, which false-positived non-Vercel prod hosts (Docker/ECS/plain
      // `next start`) into selecting a guaranteed-throw provider that silently degraded every scan to mock.
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
    case "openrouter":
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
      if (choice === "openrouter") return new OpenRouterProvider();
      return new LazyClaudeCliProvider();
    case "gemini":
      // EXPLICIT gemini selection: construct the REAL provider unconditionally, mirroring the
      // bedrock/openai branches above. geminiOrMock()'s keyless→mock shortcut (correct for `auto`) made
      // intendedProvider="mock" downstream when the key was missing/typo'd, which suppressed the
      // llmFailed warning + the fallback SSE entirely — the operator believed real AI was scoring while
      // it served the deterministic floor. A keyless GeminiProvider now fails LOUD at assess() and
      // degrades through the accounted retry → failover → mock chain (honest caveat). GEMINI_API_KEY or
      // its GOOGLE_API_KEY alias, else "" so the assess() keyless guard fires.
      return new GeminiProvider(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "");
    case "auto":
    default:
      // AUTO/default: absent config → mock is CORRECT here (not "broken config"), so keep geminiOrMock().
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
    case "openrouter":
      return providerAvailable("openrouter") ? new OpenRouterProvider() : null;
    case "claude-cli":
      return providerAvailable("claude-cli") ? new LazyClaudeCliProvider() : null;
    default:
      return null;
  }
}

/**
 * Org-aware provider selection (BYOM — Feature 1). When the org has an ACTIVE Bedrock config (enabled
 * + creds + Enterprise plan + ENCRYPTION_KEY — see resolveByomProvider), build a Bedrock provider with
 * the org's DECRYPTED credentials so inference runs in their AWS account; `byom:true` tells the scan
 * pipeline to skip platform credits + the platform fallback (fail to mock, §8.2). Otherwise fall back
 * to the env-driven getProvider() (the anonymous/public + non-BYOM path is unchanged). forceMock wins.
 */
export async function getProviderForOrg(
  orgSlug: string | undefined | null,
  opts: { forceMock?: boolean } = {},
): Promise<{ provider: LLMProvider; byom: boolean }> {
  if (opts.forceMock) return { provider: new MockProvider(), byom: false };
  if (orgSlug && orgSlug !== "public") {
    const { resolveByomState } = await import("@/lib/db/org-llm");
    // ONE read of the org's BYOM state, and NO `.catch()` around it. The two swallowing catches this
    // replaced (`resolveByomProvider(...).catch(() => null)` then `isByomActive(...).catch(() => false)`)
    // meant an infrastructure failure — a DB blip, a plan-lookup timeout — resolved to "this org has no
    // BYOM" and fell straight through to the platform provider below. That is the exact breach the
    // fail-closed branch was written to prevent, defeated by the error handling of its own condition:
    // an Enterprise org's private repository source routed to the platform Gemini/OpenAI endpoint, with
    // byom:false and no caveat, for the length of the outage. "Couldn't tell" is not "no BYOM", so the
    // error propagates and the scan fails loudly instead of quietly leaving the customer's boundary.
    const byom = await resolveByomState(orgSlug);
    if (byom.state === "active") {
      // Bedrock keeps inference in the org's AWS boundary; OpenRouter routes to third-party upstreams
      // with the org's own key (a cost/flexibility BYOM, not the privacy one). Either way `byom:true`
      // tells the scan pipeline to skip platform credits + the platform fallback.
      const p = byom.params;
      const provider =
        p.kind === "openrouter"
          ? new OpenRouterProvider({ model: p.model, apiKey: p.apiKey })
          : new BedrockProvider({ model: p.model, region: p.region, credentials: p.credentials });
      return { provider, byom: true };
    }
    // ACTIVE but unresolvable — an ENCRYPTION_KEY rotation, a decrypt failure, or a tampered blob.
    // Silently routing this org's private source through the env platform provider would breach the
    // in-boundary inference contract Enterprise paid for. FAIL CLOSED with an actionable error.
    if (byom.state === "unresolvable") {
      throw new Error(
        `BYOM is enabled for organization "${orgSlug}" but its stored provider credentials could not be ` +
          `resolved. Refusing to fall back to the platform LLM provider, so your repository contents ` +
          `only ever reach the provider you connected. Verify ENCRYPTION_KEY and re-save the ` +
          `organization's BYOM credentials, then retry the scan.`,
      );
    }
  }
  return { provider: getProvider(opts), byom: false };
}

export { MockProvider };
export type { LLMProvider };
