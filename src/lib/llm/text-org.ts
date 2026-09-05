// ORG-AWARE text seam — the text.ts twin of getProviderForOrg().
//
// THE GAP THIS CLOSES: resolveTextRunner() reads only env, so a deployment whose orgs all run BYOM —
// no platform GEMINI_API_KEY / OPENAI_API_KEY at all, which is exactly the shape an enterprise buys
// when it connects its own Bedrock account — got `null` from every non-scan LLM surface. Scans ran
// fine on the org's own model while Shared Org Memory's write-gate and reflection passes reported
// "no engine" forever, for the customers paying the most. There was no configuration that fixed it.
//
// Selection mirrors getProviderForOrg() exactly, including its FAIL-CLOSED rule: an org whose BYOM is
// active but unresolvable must not have its content quietly rerouted to the platform provider. The
// prompts this seam carries are org memory content, which is no less private than repo source.

import {
  bedrockLegRunner,
  openRouterLegRunner,
  resolveLegRunner,
  textRunnerFrom,
  type ResolvedLegRunner,
  type ResolvedTextRunner,
  type TextRunnerOptions,
} from "@/lib/llm/text";
import { llmTimeoutMs } from "@/lib/llm/config";
import { DEFAULT_BEDROCK_REGION } from "@/lib/llm/bedrock";

/**
 * Resolve the RAW leg runner for an ORG — its connected BYOM provider when one is active, else the
 * env-driven platform runner (identical to {@link resolveLegRunner}), else null.
 *
 * THROWS when the org's BYOM is active but unresolvable, or when its state cannot be determined at
 * all — the same two fail-closed cases getProviderForOrg() enforces, for the same reason: "couldn't
 * tell" is not "no BYOM", and guessing routes the org's content to a provider it never connected.
 *
 * `null` remains the ordinary "no engine here" answer (no BYOM, no platform key, mock, or a claude-cli
 * selection in production) and callers surface it as `llmUnavailable`.
 */
export async function resolveLegRunnerForOrg(
  orgSlug: string | undefined | null,
  opts: TextRunnerOptions,
): Promise<ResolvedLegRunner | null> {
  return (await resolveLegRunnerWithProvenance(orgSlug, opts)).runner;
}

/**
 * The same resolution, plus WHOSE ACCOUNT answered.
 *
 * The meter needs a fact only this function can know: a BYOM call is billed to the org's own vendor,
 * so Ascent has no cost figure for it and must record `null` rather than pricing the tokens at list
 * rates the org never paid. `byom` is `true` on the BYOM branch, `false` on the platform branch, and
 * `undefined` only where the question was never asked — the honest three-state, not a defaulted boolean.
 */
export async function resolveLegRunnerWithProvenance(
  orgSlug: string | undefined | null,
  opts: TextRunnerOptions,
): Promise<{ runner: ResolvedLegRunner | null; byom: boolean | undefined }> {
  if (orgSlug && orgSlug !== "public") {
    // Dynamic import so the db layer never lands in a bundle that only wanted the env path — the same
    // discipline getProviderForOrg uses for this exact module.
    const { resolveByomState } = await import("@/lib/db/org-llm");
    // Deliberately un-caught: see the module header and getProviderForOrg's own note.
    const byom = await resolveByomState(orgSlug);
    if (byom.state === "active") {
      const p = byom.params;
      return {
        runner:
          p.kind === "openrouter"
            ? openRouterLegRunner(p.model, p.apiKey)
            : bedrockLegRunner(p.model, p.region ?? DEFAULT_BEDROCK_REGION, p.credentials),
        byom: true,
      };
    }
    if (byom.state === "unresolvable") {
      throw new Error(
        `BYOM is enabled for organization "${orgSlug}" but its stored provider credentials could not be ` +
          `resolved. Refusing to fall back to the platform LLM provider, so this organization's content ` +
          `only ever reaches the provider you connected. Verify ENCRYPTION_KEY and re-save the ` +
          `organization's BYOM credentials.`,
      );
    }
  }
  // The platform account answered: Ascent IS billed, so the meter prices these tokens.
  return { runner: await resolveLegRunner(opts), byom: false };
}

/**
 * Resolve a single-shot text runner for an ORG. The metered/timed wrapper over
 * {@link resolveLegRunnerForOrg} — selection, the fail-closed rule and the BYOM transports are shared
 * with the tool loop, so an enterprise on its own Bedrock account gets Athena on the SAME account that
 * runs its scans rather than "no engine".
 */
export async function resolveTextRunnerForOrg(
  orgSlug: string | undefined | null,
  opts: TextRunnerOptions,
): Promise<ResolvedTextRunner | null> {
  const { runner, byom } = await resolveLegRunnerWithProvenance(orgSlug, opts);
  if (!runner) return null;
  // Attribution is filled in HERE rather than at every call site: this function already knows the org
  // and now knows whose account served it, so a caller that passes neither still meters correctly. An
  // explicit `opts.meter` always wins — a caller that knows better (a repo, a team, a ref) is not
  // overridden by a default.
  const metered: TextRunnerOptions = {
    ...opts,
    meter: {
      ...opts.meter,
      // MC-B20: the org's OWN slug, with no string-shaped exception. A second copy of the funnel
      // sentinel lived here and dropped attribution before `meter()` ever saw it, so a tenant on that
      // slug was un-metered twice over. Whether an org's calls are ledgered is decided from its row
      // (`Organization.kind`) in `recordUsageEvent`, not from what its slug happens to spell.
      orgSlug: opts.meter?.orgSlug ?? (orgSlug || null),
      byom: opts.meter?.byom ?? byom,
    },
  };
  return textRunnerFrom(runner, opts.timeoutMs ?? llmTimeoutMs(), metered);
}
