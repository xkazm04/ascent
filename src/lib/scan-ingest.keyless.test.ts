// A TOKEN-LESS scan SKIPPED the GitHub-side reads; it did not find the controls absent.
//
// The skip is the third case beside a failed read (`sensorFailures`) and a blind worktree. These pin
// the join end-to-end (ingest -> score-input -> warnings), like scan-ingest.test.ts does for failures.

import { describe, it, expect } from "vitest";
import { ingestRepository } from "./scan-ingest";
import { buildScanScoreInput } from "./scan-score-input";
import { buildScanWarnings } from "./scan-compose";
import type { EnrichmentSource, Forge } from "@/lib/forge/types";
import type { ParsedRepo, RepoSource } from "@/lib/github/source";
import type { RepoSnapshot, SecurityPosture } from "@/lib/types";

const NOW = "2026-06-02T00:00:00Z";
const PARSED: ParsedRepo = { owner: "acme", repo: "r" };

function snapshot(extra: { path: string; content: string }[] = []): RepoSnapshot {
  const files = [
    { path: ".github/workflows/ci.yml", content: "on: [push]\npermissions:\n  contents: read\njobs: {}" },
    { path: "README.md", content: "# r" },
    ...extra,
  ];
  return {
    meta: { owner: "acme", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main", headSha: "sha1" },
    tree: files.map((f) => ({ path: f.path, type: "blob" as const })),
    files: files.map((f) => ({ path: f.path, content: f.content, bytes: f.content.length })),
    commits: [{ message: "feat: x" }],
    truncated: false,
    coverage: 1,
  };
}

const ORG_POLICY: SecurityPosture = { advisoryCount: 0, advisoryCapped: false, orgSecurityPolicy: true };

function forgeWith(enrich: EnrichmentSource, source: RepoSource): Forge {
  return {
    id: "github",
    label: "GitHub",
    capabilities: {
      pullRequests: true, branchGovernance: true, deployments: true, ciHealth: true,
      securityPosture: true, securityExposure: true, appInventory: true, codeowners: true,
      write: true, anonymous: true,
    },
    parseUrl: () => PARSED,
    source: () => source,
    enrich: () => enrich,
    permalink: () => "",
  };
}

const FULL: EnrichmentSource = {
  securityPosture: () => Promise.resolve(ORG_POLICY),
  appInventory: () => Promise.resolve({ sha: "sha1", apps: [], total: 0, truncated: false }),
  branchGovernance: () => Promise.resolve(null),
  securityExposure: () => Promise.resolve(null),
  ciHealth: () => Promise.resolve(null),
  deployments: () => Promise.resolve([]),
};

async function run(enrich: EnrichmentSource, token: string | undefined, extra: { path: string; content: string }[] = []) {
  const source: RepoSource = { async fetchSnapshot() { return snapshot(extra); } };
  const result = await ingestRepository({ parsed: PARSED, source, forge: forgeWith(enrich, source), token, emit: () => {} });
  const { scoreInput } = await buildScanScoreInput({
    snapshot: result.snapshot,
    prStats: result.prStats,
    governance: result.governance,
    securityPosture: result.securityPosture,
    securityExposure: result.securityExposure,
    appInventory: result.appInventory,
    ciHealth: result.ciHealth,
    sensorFailures: result.sensorFailures,
    sensorSkips: result.sensorSkips,
    now: NOW,
  });
  const checks = scoreInput.securityAssessment!.checks;
  return { result, check: (id: string) => checks.find((c) => c.id === id)! };
}

const warn = (result: Awaited<ReturnType<typeof run>>["result"], hasToken: boolean) =>
  buildScanWarnings({
    detectorWarnings: [], hasToken, llmFailed: false, providerName: "gemini", explicitMock: false,
    snapshotTruncated: false, snapshotCoverage: 1, stackFit: null, prPartial: false, prFetchFailed: false,
    sensorFailures: result.sensorFailures, sensorSkips: result.sensorSkips,
  });

describe("a token-less ingest records its skips", () => {
  it("lists the skipped score-bearing sensors and leaves sensorFailures empty", async () => {
    const { result } = await run(FULL, undefined);
    expect(result.sensorFailures).toEqual([]);
    expect(result.sensorSkips).toEqual(["governance", "securityPosture", "securityExposure", "appInventory", "ciHealth", "deployments"]);
  });

  it("a forge that lacks an enrichment member records no skip for it", async () => {
    const { result } = await run({ securityPosture: FULL.securityPosture }, undefined);
    expect(result.sensorSkips).toEqual(["securityPosture"]);
  });

  it("a tokened scan skips nothing", async () => {
    const { result } = await run(FULL, "t");
    expect(result.sensorSkips).toEqual([]);
  });
});

describe("the D9 battery excludes what a keyless scan never read", () => {
  it("excludes security-policy, sast and dependency-updates, naming the skipped read", async () => {
    const { check } = await run(FULL, undefined);
    for (const id of ["security-policy", "sast", "dependency-updates"]) {
      expect(check(id).score).toBeNull();
      expect(check(id).evidence).toContain("skipped because the scan had no token");
      expect(check(id).remediation).toBeUndefined();
    }
    expect(check("token-permissions").score).toBe(10);
  });

  it("a repo-local SECURITY.md still scores 10 and a committed dependabot.yml still scores", async () => {
    const { check } = await run(FULL, undefined, [
      { path: "SECURITY.md", content: "# Security\nReport privately to security@example.test." },
      { path: ".github/dependabot.yml", content: "version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n    schedule:\n      interval: weekly\n" },
    ]);
    expect(check("security-policy").score).toBe(10);
    expect(check("dependency-updates").score).toBeGreaterThan(0);
  });

  it("a tokened scan whose reads succeed scores exactly as before", async () => {
    const { check } = await run(FULL, "t");
    expect(check("security-policy").score).toBe(8);
    expect(check("sast").score).toBe(0);
    expect(check("dependency-updates").score).toBe(0);
  });
});

describe("the keyless warning names the skipped security reads", () => {
  it("adds the org policy and App inventory beside the PR line", async () => {
    const { result } = await run(FULL, undefined);
    const warnings = warn(result, false);
    expect(warnings[0]).toContain("Pull-request signals were skipped");
    expect(warnings[1]).toContain("org security policy");
    expect(warnings[1]).toContain("installed-App inventory");
  });

  it("a tokened scan emits no skip caveat", async () => {
    const { result } = await run(FULL, "t");
    expect(warn(result, true)).toEqual([]);
  });
});
