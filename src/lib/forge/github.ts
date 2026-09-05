// The GitHub `Forge` record — POINTERS, not code.
//
// Read this file as a wiring diagram. Every field below is a reference to a function that already
// existed and still lives in `src/lib/github/**`; nothing was moved, copied, adapted or "cleaned up"
// on the way through. `github-parity.test.ts` asserts that field by field with `toBe` (reference
// identity), so the moment someone re-implements one of these inline — the natural, well-meant drift
// that turns an extraction into a rewrite — the suite goes red.
//
// That discipline is the whole risk control for moonshot #4: a second forge is only safe to add once
// the first one is provably the same code path it was before the seam existed.

import {
  GitHubPublicSource,
  fetchGuidanceFreshness,
  parseRepoUrl,
} from "@/lib/github/source";
import { fetchPrStats } from "@/lib/analyze/pulls";
import { fetchBranchGovernance, fetchCommitActivity } from "@/lib/github/governance";
import { fetchDeployments } from "@/lib/github/deployments";
import { fetchSecurityPosture } from "@/lib/github/security-posture";
import { fetchAppInventory } from "@/lib/github/check-suites";
import { fetchCiHealth } from "@/lib/github/actions-health";
import { fetchSecurityExposure } from "@/lib/security/exposure";
import { githubWebBase } from "@/lib/github/host";
import type { EnrichmentSource, Forge, ForgeCapabilities, ParsedRepo, RepoSource } from "@/lib/forge/types";

/**
 * What GitHub can be asked. Every one of these is `true` because every one of them has a real reader
 * in `src/lib/github/**` today — the manifest is a statement about the CODE, not an aspiration, and
 * the parity test is what keeps it that way (a `true` with no bound member fails).
 */
export const GITHUB_CAPABILITIES: ForgeCapabilities = {
  pullRequests: true,
  branchGovernance: true,
  deployments: true,
  ciHealth: true,
  securityPosture: true,
  securityExposure: true,
  appInventory: true,
  codeowners: true,
  write: true,
  // A keyless public scan is the funnel's whole shape on GitHub: the raw host isn't billed against
  // the REST rate limit, so an anonymous read of a public repo is honest here.
  anonymous: true,
};

/**
 * The enrichment set. Each member is the SAME function object `scan-ingest.ts` called directly before
 * this seam existed — see the file header. The map is frozen so a caller cannot monkey-patch a member
 * and quietly change what "GitHub" means for the rest of the process.
 */
export const GITHUB_ENRICHMENTS: EnrichmentSource = Object.freeze({
  pullRequests: fetchPrStats,
  branchGovernance: fetchBranchGovernance,
  deployments: fetchDeployments,
  ciHealth: fetchCiHealth,
  securityPosture: fetchSecurityPosture,
  securityExposure: fetchSecurityExposure,
  appInventory: fetchAppInventory,
  commitActivity: fetchCommitActivity,
  guidanceFreshness: fetchGuidanceFreshness,
});

/**
 * `host` is accepted and deliberately IGNORED for GitHub. GHES is already resolved — and has been
 * since long before this lane — by the `GITHUB_API_URL` / `GITHUB_GRAPHQL_URL` / `GITHUB_RAW_URL` env
 * vars in `src/lib/github/host.ts`, read at module scope by `source.ts`. Threading a per-call host
 * through GitHub's readers would be a behaviour change to the one path this lane must prove
 * byte-identical, so the env resolution stays the single source and still wins. A self-hosted GitLab
 * uses the `host` override; a GHES deployment keeps the env vars it already has.
 */
export const githubForge: Forge = {
  id: "github",
  label: "GitHub",
  capabilities: GITHUB_CAPABILITIES,
  // Reference-equal to the historic entry point on purpose: the router and `parseRepoUrl` are the
  // SAME parser, so they cannot disagree about what a GitHub URL is.
  parseUrl: parseRepoUrl,
  source(): RepoSource {
    return new GitHubPublicSource();
  },
  enrich(): EnrichmentSource {
    return GITHUB_ENRICHMENTS;
  },
  permalink(repo: ParsedRepo, sha?: string): string {
    const base = `${githubWebBase()}/${repo.owner}/${repo.repo}`;
    return sha ? `${base}/tree/${sha}` : base;
  },
};
