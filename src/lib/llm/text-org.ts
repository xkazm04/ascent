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

import { bedrockRunner, openRouterRunner, resolveTextRunner, type ResolvedTextRunner, type TextRunnerOptions } from "@/lib/llm/text";
import { llmTimeoutMs } from "@/lib/llm/config";
import { DEFAULT_BEDROCK_REGION } from "@/lib/llm/bedrock";

/**
 * Resolve a text runner for an ORG — its connected BYOM provider when one is active, else the
 * env-driven platform runner (identical to {@link resolveTextRunner}), else null.
 *
 * THROWS when the org's BYOM is active but unresolvable, or when its state cannot be determined at
 * all — the same two fail-closed cases getProviderForOrg() enforces, for the same reason: "couldn't
 * tell" is not "no BYOM", and guessing routes the org's content to a provider it never connected.
 *
 * `null` remains the ordinary "no engine here" answer (no BYOM, no platform key, mock, or a claude-cli
 * selection in production) and callers surface it as `llmUnavailable`.
 */
export async function resolveTextRunnerForOrg(
  orgSlug: string | undefined | null,
  opts: TextRunnerOptions = {},
): Promise<ResolvedTextRunner | null> {
  if (orgSlug && orgSlug !== "public") {
    // Dynamic import so the db layer never lands in a bundle that only wanted the env path — the same
    // discipline getProviderForOrg uses for this exact module.
    const { resolveByomState } = await import("@/lib/db/org-llm");
    // Deliberately un-caught: see the module header and getProviderForOrg's own note.
    const byom = await resolveByomState(orgSlug);
    if (byom.state === "active") {
      const timeoutMs = opts.timeoutMs ?? llmTimeoutMs();
      const p = byom.params;
      return p.kind === "openrouter"
        ? openRouterRunner(p.model, p.apiKey, timeoutMs, opts)
        : bedrockRunner(p.model, p.region ?? DEFAULT_BEDROCK_REGION, timeoutMs, opts, p.credentials);
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
  return resolveTextRunner(opts);
}
