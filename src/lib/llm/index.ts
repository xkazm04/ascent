// Provider selection via the LLM_PROVIDER env flag.
//
//   LLM_PROVIDER=gemini     -> Gemini (local dev & testing default). Falls back to mock
//                              if no GEMINI_API_KEY is set.
//   LLM_PROVIDER=openai     -> OpenAI / Azure-OpenAI / OpenAI-compatible (vLLM, Ollama, …).
//   LLM_PROVIDER=openrouter -> OpenRouter (one key, any vendor's model — the fleet/bench path).
//   LLM_PROVIDER=bedrock    -> AWS Bedrock / Claude Sonnet (Phase 2, enterprise privacy).
//   LLM_PROVIDER=local      -> a local OpenAI-compatible server: Ollama / vLLM / LM Studio. Nothing
//                              leaves the machine and the tokens cost $0.
//   LLM_PROVIDER=nebius     -> Nebius Token Factory: hosted open-weight inference (billed per token).
//   LLM_PROVIDER=claude-cli -> the local `claude` CLI under your subscription. Available in dev, and
//                              on a SELF-HOSTED production build (see the registry's lazy CLI proxy).
//   LLM_PROVIDER=codex-cli  -> the local `codex` CLI under your ChatGPT plan. Same gate and same
//                              deployments as claude-cli. Explicit-only, like claude-cli: the auto
//                              ladder never selects a CLI provider.
//   LLM_PROVIDER=gateway    -> the local LightTrack gateway (`lt-gateway`, src/lib/llm/gateway.ts): one
//                              OpenAI-compatible endpoint that routes the `assess` use case to a
//                              MEASURED seat (claude -p / codex exec) with the other seat as the
//                              usage-limit fallback — see gateway.toml + docs/LLM_ROUTES.md. Explicit
//                              only, like the CLI providers; needs no key.
//   LLM_PROVIDER=mock       -> deterministic, keyless.
//   LLM_PROVIDER=auto       -> (default) Gemini if a key is present, else a configured LOCAL server,
//                              else mock. Never silently selects Bedrock — that's opt-in via the flag.
//
// Keep Gemini local: set LLM_PROVIDER=gemini in .env.local. Switch to Bedrock in
// production by setting LLM_PROVIDER=bedrock + AWS credentials/region.
//
// Every answer below is a READ of the provider registry (src/lib/llm/registry.ts): which names are
// valid, which provider is available, what `auto` picks and what each name constructs live in ONE
// keyed table, so this module's exports keep their signatures while a new provider becomes one
// descriptor instead of an edit to every switch that used to live here.

import type { LLMProvider } from "@/lib/llm/provider";
import type { ProviderName } from "@/lib/types";
import { MockProvider } from "@/lib/llm/mock";
import { cliProviderAllowed } from "@/lib/llm/config";
import {
  PROVIDER_NAMES,
  REGISTRY,
  autoProviderName,
  byomDescriptor,
  geminiApiKey,
  isProviderName,
} from "@/lib/llm/registry";

// Re-exported from its leaf home in config.ts so `@/lib/llm` stays the one import surface callers use.
export { cliProviderAllowed };
export { autoProviderName };

export type ProviderChoice = "auto" | ProviderName;

export function hasLlmKey(): boolean {
  return Boolean(geminiApiKey());
}

/** Derived from the registry, never hand-kept: a provider with a descriptor is a valid choice. */
const PROVIDER_CHOICES: readonly ProviderChoice[] = ["auto", ...PROVIDER_NAMES];

export function resolveProviderChoice(): ProviderChoice {
  const raw = (process.env.LLM_PROVIDER ?? "").trim();
  if (!raw) return "auto";
  const v = raw.toLowerCase();
  if ((PROVIDER_CHOICES as readonly string[]).includes(v)) return v as ProviderChoice;
  // Fail LOUD on an unrecognized non-empty value instead of coercing it to "auto". The rest of this
  // module refuses to let an explicit-but-misconfigured selection degrade silently (see getProvider),
  // yet a typo in the provider NAME itself — the most likely operator error, e.g. LLM_PROVIDER=bedrok
  // on an enterprise-privacy deploy — previously became auto → Gemini-or-mock with zero signal,
  // routing private source to a provider the operator never chose. An unknown value is broken config,
  // not absent config: refuse to guess. (ambiguity-ui-scan-2026-07-16 llm-provider-abstraction #1)
  throw new Error(
    `Unknown LLM_PROVIDER "${raw}" — expected one of ${PROVIDER_CHOICES.join(", ")}. ` +
      `Refusing to fall back to "auto": a typo'd provider must fail loudly rather than silently ` +
      `route scans through a provider you did not choose. Fix or unset LLM_PROVIDER.`,
  );
}

/**
 * Cheap, synchronous prerequisite check so a misconfigured provider is skipped in the failover
 * INSTEAD of spending the full retry/failover budget proving the obvious (a keyless openai, a
 * region-less bedrock, a CLI on a host with no binary). Construction is side-effect-free; this just
 * gates it on env presence. Each rule lives on its registry descriptor.
 */
export function providerAvailable(name: ProviderName): boolean {
  return isProviderName(name) ? REGISTRY[name].available() : false;
}

export function getProvider(opts: { forceMock?: boolean } = {}): LLMProvider {
  if (opts.forceMock) return new MockProvider();
  const choice = resolveProviderChoice();
  // AUTO/default: absent config → the registry's one auto ladder (gemini → local → mock); mock is
  // CORRECT there, not "broken config".
  //
  // EXPLICIT: trust the operator's selection and construct the REAL provider unconditionally, even when
  // its prerequisite looks absent. Pre-degrading a selected-but-unavailable provider to mock here set
  // intendedProvider="mock" downstream, which suppressed the llmFailed warning + the fallback SSE event
  // entirely — so a misconfigured (or merely env-sniff-false-negative) deploy served mock scores with NO
  // caveat (success theater). A genuinely broken config instead fails fast at assess(), and the retry →
  // failover → mock chain degrades WITH honest accounting. That includes a keyless explicit `gemini`.
  const name = choice === "auto" ? autoProviderName() : choice;
  return REGISTRY[name].scan();
}

/**
 * Construct a specific real provider by name — for the scan's `LLM_FALLBACK_PROVIDER` failover
 * (try a second model on a transient primary failure before degrading to the deterministic mock).
 * Returns null for "mock"/unknown/empty: those mean "no real fallback", and the caller degrades to
 * MockProvider itself. Construction is side-effect-free (no network until assess()).
 *
 * A failover to an UNAVAILABLE provider also returns null, so the orchestrator SKIPS the doomed attempt
 * rather than wasting a round trip that always throws. Gemini included: a keyless Gemini returned from
 * here would run as a "successful" failover step, suppressing the llmFailed warning, the fallback SSE
 * event and the operator's error log. Keyless-by-name must be null, per this function's contract.
 */
export function providerByName(name: string | undefined | null): LLMProvider | null {
  const n = (name ?? "").trim().toLowerCase();
  if (!isProviderName(n) || n === "mock") return null;
  const d = REGISTRY[n];
  return d.available() ? d.scan() : null;
}

/**
 * Org-aware provider selection (BYOM — Feature 1). When the org has an ACTIVE BYOM config (enabled
 * + creds + Enterprise plan + ENCRYPTION_KEY — see resolveByomState), build the org's provider with
 * its DECRYPTED credentials so inference runs on its own account; `byom:true` tells the scan
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
      // with the org's own key (a cost/flexibility BYOM, not the privacy one). The kind → provider
      // mapping is the registry's byomDescriptor, shared with the text seam (text-org.ts).
      return { provider: byomDescriptor(byom.params).scan(), byom: true };
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
