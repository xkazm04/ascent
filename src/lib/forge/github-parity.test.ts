// THE STRUCTURAL GUARD FOR MOONSHOT #4.
//
// This lane's entire risk control is that promoting `RepoSource` into a `Forge` registry did not
// change the GitHub path. The only way that stays true across future edits is if "the GitHub adapter
// IS the GitHub code" is a machine-checked fact rather than a convention — so every assertion below
// is `toBe` (reference identity), not a behavioural approximation.
//
// What it would catch: someone re-implements `branchGovernance` inline in the adapter "to add a
// try/catch", or wraps `fetchPrStats` in a lambda that reorders arguments. Both compile, both pass a
// behavioural test written against a fixture, and both are exactly how an extraction quietly becomes
// a rewrite. Reference identity is the only assertion that sees them.
//
// FAIL-BEFORE (verified, see the handoff): replacing `pullRequests: fetchPrStats` with
// `pullRequests: (o, r, t, s) => fetchPrStats(o, r, t, s)` in `github.ts` turns the "bound by
// reference" case red while every other test in the suite stays green.

import { describe, expect, it } from "vitest";
import { GITHUB_CAPABILITIES, GITHUB_ENRICHMENTS, githubForge } from "@/lib/forge/github";
import { resolveForge } from "@/lib/forge/registry";
import { GitHubPublicSource, parseRepoUrl, quarantineMemoryFiles, fetchGuidanceFreshness } from "@/lib/github/source";
import { fetchPrStats } from "@/lib/analyze/pulls";
import { fetchBranchGovernance, fetchCommitActivity } from "@/lib/github/governance";
import { fetchDeployments } from "@/lib/github/deployments";
import { fetchSecurityPosture } from "@/lib/github/security-posture";
import { fetchAppInventory } from "@/lib/github/check-suites";
import { fetchCiHealth } from "@/lib/github/actions-health";
import { fetchSecurityExposure } from "@/lib/security/exposure";
import type { ForgeCapabilities } from "@/lib/forge/types";

/** capability key → the `src/lib/github/*` export it must be bound to, by reference. */
const BOUND: Partial<Record<keyof ForgeCapabilities, { member: string; fn: unknown }>> = {
  pullRequests: { member: "pullRequests", fn: fetchPrStats },
  branchGovernance: { member: "branchGovernance", fn: fetchBranchGovernance },
  deployments: { member: "deployments", fn: fetchDeployments },
  ciHealth: { member: "ciHealth", fn: fetchCiHealth },
  securityPosture: { member: "securityPosture", fn: fetchSecurityPosture },
  securityExposure: { member: "securityExposure", fn: fetchSecurityExposure },
  appInventory: { member: "appInventory", fn: fetchAppInventory },
};

describe("github forge parity (structural guard)", () => {
  it("binds every declared enrichment BY REFERENCE to its src/lib/github export", () => {
    const enrich = githubForge.enrich!() as Record<string, unknown>;
    for (const [capability, expected] of Object.entries(BOUND)) {
      expect(enrich[expected.member], `${capability} must be the src/lib/github export itself`).toBe(
        expected.fn,
      );
    }
    // Two members have no capability flag of their own — they are unconditional GitHub reads.
    expect(enrich.commitActivity).toBe(fetchCommitActivity);
    expect(enrich.guidanceFreshness).toBe(fetchGuidanceFreshness);
  });

  it("declares a capability only where a member actually exists", () => {
    const enrich = githubForge.enrich!() as Record<string, unknown>;
    for (const [capability, expected] of Object.entries(BOUND)) {
      const declared = GITHUB_CAPABILITIES[capability as keyof ForgeCapabilities];
      // The manifest is a claim about the CODE. A `true` with nothing behind it would put a
      // capability in the report's observability table that no reader can answer.
      expect(declared, `${capability} is declared true`).toBe(true);
      expect(typeof enrich[expected.member], `${capability} has a bound reader`).toBe("function");
    }
  });

  it("routes the pipeline to the same source construction it used before the seam", () => {
    // `scan.ts` used to call `new GitHubPublicSource()` literally. The routed path must build the
    // same class — a different snapshot reader is the one change that WOULD move every score.
    expect(resolveForge()).toBe(githubForge);
    expect(resolveForge({ forge: "github" })).toBe(githubForge);
    expect(githubForge.source()).toBeInstanceOf(GitHubPublicSource);
  });

  it("uses the historic parser itself, so the router and parseRepoUrl cannot disagree", () => {
    expect(githubForge.parseUrl).toBe(parseRepoUrl);
  });

  it("carries W1-B's memory quarantine through the routed path (ruling W4-#6)", () => {
    // The quarantine is what keeps agent-written `.ai/memory` prose out of every prompt and scorer.
    // It lives in ONE exported function precisely so an extraction cannot lose it, and the routed
    // GitHub source is the same `GitHubPublicSource` that applies it — asserted above by class
    // identity, and here by the partition's own behaviour over the shared symbol.
    const fetched = [
      { path: "README.md", content: "hi", bytes: 2 },
      { path: ".ai/memory/0007-a-decision.md", content: "secret prose", bytes: 12 },
    ];
    const picks = ["README.md", ".ai/memory/0007-a-decision.md"];
    const out = quarantineMemoryFiles(fetched, picks);
    expect(out.files.map((f) => f.path)).toEqual(["README.md"]);
    expect(out.memoryFiles.map((f) => f.path)).toEqual([".ai/memory/0007-a-decision.md"]);
    // The mirror must not be able to move coverage (and through it, the cache-pinning threshold).
    expect(out.nonMemoryAttempted).toBe(1);
  });

  it("keeps the enrichment map frozen so a caller cannot redefine what GitHub means", () => {
    expect(Object.isFrozen(GITHUB_ENRICHMENTS)).toBe(true);
  });
});
