// Provider selection via the LLM_PROVIDER env flag.
//
//   LLM_PROVIDER=gemini     -> Gemini (local dev & testing default). Falls back to mock
//                              if no GEMINI_API_KEY is set.
//   LLM_PROVIDER=openai     -> OpenAI / Azure-OpenAI / OpenAI-compatible (vLLM, Ollama, …).
//   LLM_PROVIDER=openrouter -> OpenRouter (one key, any vendor's model — the fleet/bench path).
//   LLM_PROVIDER=bedrock    -> AWS Bedrock / Claude Sonnet (Phase 2, enterprise privacy).
//   LLM_PROVIDER=local      -> a local OpenAI-compatible server: Ollama / vLLM / LM Studio. Nothing
//                              leaves the machine and the tokens cost $0.
//   LLM_PROVIDER=claude-cli -> the local `claude` CLI under your subscription. Available in dev, and
//                              on a SELF-HOSTED production build (see LazyClaudeCliProvider).
//   LLM_PROVIDER=mock       -> deterministic, keyless.
//   LLM_PROVIDER=auto       -> (default) Gemini if a key is present, else a configured LOCAL server,
//                              else mock. Never silently selects Bedrock — that's opt-in via the flag.
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
import { LocalProvider, localLlmConfigured } from "@/lib/llm/local";
import { cliProviderAllowed } from "@/lib/llm/config";

// Re-exported from its leaf home in config.ts so `@/lib/llm` stays the one import surface callers use.
export { cliProviderAllowed };

export type ProviderChoice = "auto" | ProviderName;


/**
 * Lazy proxy for the claude-cli provider. It shells out via child_process to a local `claude` binary.
 * The dynamic import defers loading claude-cli.ts until a scan actually runs under it; `name`/`model`
 * resolve synchronously so the scan pipeline can read them before the (lazy) assess().
 * `providerAvailable` gates on the same {@link cliProviderAllowed} predicate, so the failover skips
 * this provider rather than selecting a guaranteed-throw one.
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
    if (cliProviderAllowed()) {
      const { ClaudeCliProvider } = await import("@/lib/llm/claude-cli");
      return new ClaudeCliProvider(this.model).assess(input, opts);
    }
    // Managed cloud: no `claude` binary on the host, so refuse rather than hang for the CLI timeout.
    throw new Error(
      "claude-cli needs a local `claude` binary and is not available on this managed deployment. " +
        "Set ASCENT_SELF_HOSTED=1 if you are running Ascent on your own machine, or choose another " +
        "LLM_PROVIDER.",
    );
  }
}

export function hasLlmKey(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

const PROVIDER_CHOICES = ["auto", "gemini", "bedrock", "openai", "openrouter", "local", "mock", "claude-cli"] as const;

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
 * The `auto` ladder: Gemini if a key is present, else a fully-configured LOCAL server, else mock.
 *
 * The local rung is what makes a keyless self-hosted install worth running. Before it, someone who
 * had Ollama up and both LOCAL_LLM_* variables set still got the deterministic mock floor from the
 * default config — the worst possible first run for an open-source product, because it looks like the
 * app works while every score is a rubric floor.
 *
 * It sits BELOW Gemini so no existing deployment changes behaviour, and it is config-driven rather
 * than probe-driven: `getProvider()` is synchronous and on the scan hot path, so it cannot make a
 * network call to sniff for a listening Ollama. `localLlmConfigured()` requires BOTH variables, so
 * `auto` only takes this rung once the operator has said what to talk to and which model to use.
 */
function autoProvider(): LLMProvider {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (key) return new GeminiProvider(key);
  if (localLlmConfigured()) return new LocalProvider();
  return new MockProvider();
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
    case "local":
      // BOTH knobs, matching LocalProvider's own guard: an endpoint with no model (or the reverse)
      // cannot complete a call, and reporting it available would put a doomed step in the failover.
      return localLlmConfigured();
    case "claude-cli":
      // Mirror LazyClaudeCliProvider.assess() exactly — same predicate, so availability and the
      // provider's own refusal can never disagree and put a guaranteed-throw step in the failover.
      return cliProviderAllowed();
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
    case "local":
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
      if (choice === "local") return new LocalProvider();
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
      // AUTO/default: absent config → mock is CORRECT here (not "broken config"). autoProvider() adds
      // one rung below Gemini for a configured local server; with neither, it is still mock.
      return autoProvider();
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
    case "local":
      return providerAvailable("local") ? new LocalProvider() : null;
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
