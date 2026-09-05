// A FAILED sensor read is UNKNOWN, never zero.
//
// Every token-gated enrichment in `ingestRepository` degrades a thrown read to the SAME value a
// successful-but-empty read produces (`null` / `[]`) — and downstream, that value is scored as
// ABSENCE. The concrete damage this file pins: a `securityPosture` read that throws made
// `securityPolicy()` publish `score: 0 — No security policy (SECURITY.md) found`, with a remediation,
// for a repository whose org-level SECURITY.md the read would have found (the score-8 branch). A
// failed `appInventory` read floored SAST and dependency-updates at 0, against the inventory's own
// documented contract that null NEVER means "no Apps installed".
//
// The test walks the real seam end-to-end at the module boundary — ingest → score-input → warnings —
// because the bug lived in the JOIN between the phases, not inside any one of them.

import { describe, it, expect, vi } from "vitest";
import { ingestRepository } from "./scan-ingest";
import { buildScanScoreInput } from "./scan-score-input";
import { buildScanWarnings } from "./scan-compose";
import type { EnrichmentSource, Forge } from "@/lib/forge/types";
import type { ParsedRepo, RepoSource } from "@/lib/github/source";
import type { RepoSnapshot, SecurityPosture } from "@/lib/types";

const NOW = "2026-06-02T00:00:00Z";
const PARSED: ParsedRepo = { owner: "acme", repo: "r" };

/** A snapshot with a workflow but no SECURITY.md, no dependabot config and no SAST — the shape whose
 *  zeros are supposed to be refutable by the GitHub-side reads. */
function snapshot(): RepoSnapshot {
  const files = [
    { path: ".github/workflows/ci.yml", content: "on: [push]\npermissions:\n  contents: read\njobs: {}" },
    { path: "README.md", content: "# r" },
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

const source: RepoSource = {
  async fetchSnapshot() {
    return snapshot();
  },
};

const ORG_POLICY: SecurityPosture = { advisoryCount: 0, advisoryCapped: false, orgSecurityPolicy: true };

/** A forge whose enrichments answer exactly as the test asks: `throw` for a failed read, a value for
 *  a successful one, and `undefined` to leave the member off entirely. */
function forgeWith(enrich: EnrichmentSource): Forge {
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

async function ingest(enrich: EnrichmentSource) {
  // A failed sensor logs at `error` by design (the server log is the operator's channel); keep the
  // suite's output about the assertions.
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return await ingestRepository({ parsed: PARSED, source, forge: forgeWith(enrich), token: "t", emit: () => {} });
  } finally {
    quiet.mockRestore();
  }
}

/** The D9 battery's verdict for one check, reached the way the pipeline reaches it. */
async function securityCheck(
  id: string,
  result: Awaited<ReturnType<typeof ingestRepository>>,
) {
  const { scoreInput } = await buildScanScoreInput({
    snapshot: result.snapshot,
    prStats: result.prStats,
    governance: result.governance,
    securityPosture: result.securityPosture,
    securityExposure: result.securityExposure,
    appInventory: result.appInventory,
    ciHealth: result.ciHealth,
    sensorFailures: result.sensorFailures,
    now: NOW,
  });
  return scoreInput.securityAssessment!.checks.find((c) => c.id === id)!;
}

describe("ingestRepository — a failed enrichment read is recorded, not swallowed", () => {
  it("records the sensor that threw and keeps the pipeline's degraded value", async () => {
    const result = await ingest({
      securityPosture: () => Promise.reject(new Error("502 from GitHub")),
    });
    expect(result.sensorFailures).toEqual(["securityPosture"]);
    expect(result.securityPosture).toBeNull(); // the shape of the pipeline is unchanged
  });

  it("records EVERY sensor that threw, in a stable order (not rejection order)", async () => {
    const boom = () => Promise.reject(new Error("boom"));
    const result = await ingest({
      ciHealth: boom,
      appInventory: boom,
      securityPosture: boom,
      branchGovernance: boom,
      securityExposure: boom,
    });
    expect(result.sensorFailures).toEqual([
      "governance",
      "securityPosture",
      "securityExposure",
      "appInventory",
      "ciHealth",
    ]);
  });

  it("a read that SUCCEEDS with nothing to report is not a failure", async () => {
    const result = await ingest({
      securityPosture: () => Promise.resolve(null),
      appInventory: () => Promise.resolve(null),
    });
    expect(result.sensorFailures).toEqual([]);
  });

  it("an enrichment the forge does not offer at all is not a failure either", async () => {
    const result = await ingest({});
    expect(result.sensorFailures).toEqual([]);
  });
});

describe("a failed posture read yields a NULL security-policy score, never 0", () => {
  it("excludes the check instead of publishing 'No security policy (SECURITY.md) found'", async () => {
    const failed = await ingest({ securityPosture: () => Promise.reject(new Error("502")) });
    const check = await securityCheck("security-policy", failed);
    expect(check.score).toBeNull();
    expect(check.evidence).toContain("not observable: securityPosture read failed");
    expect(check.evidence).not.toContain("No security policy (SECURITY.md) found.");
    expect(check.remediation).toBeUndefined();
  });

  it("a read that RAN and found no org policy still scores 0 with its remediation", async () => {
    // Real measured absence — the case the exclusion above must not swallow.
    const ran = await ingest({ securityPosture: () => Promise.resolve(null) });
    const check = await securityCheck("security-policy", ran);
    expect(check.score).toBe(0);
    expect(check.remediation).toBeDefined();
  });

  it("and a read that FOUND the org policy still scores 8 — the branch the failure was hiding", async () => {
    const found = await ingest({ securityPosture: () => Promise.resolve(ORG_POLICY) });
    const check = await securityCheck("security-policy", found);
    expect(check.score).toBe(8);
  });

  it("a failed App-inventory read excludes SAST and dependency-updates the same way", async () => {
    const failed = await ingest({ appInventory: () => Promise.reject(new Error("403")) });
    expect((await securityCheck("sast", failed)).score).toBeNull();
    expect((await securityCheck("dependency-updates", failed)).score).toBeNull();
    // Not a blanket blind-out: what the FILES say is still measured.
    expect((await securityCheck("token-permissions", failed)).score).toBe(10);
  });
});

describe("the failure reaches the report's one honesty channel", () => {
  it("buildScanWarnings emits a caveat naming the sensors that did not run", async () => {
    const failed = await ingest({
      securityPosture: () => Promise.reject(new Error("502")),
      appInventory: () => Promise.reject(new Error("403")),
    });
    const warnings = buildScanWarnings({
      detectorWarnings: [],
      hasToken: true,
      llmFailed: false,
      providerName: "gemini",
      explicitMock: false,
      snapshotTruncated: false,
      snapshotCoverage: 1,
      stackFit: null,
      prPartial: false,
      prFetchFailed: false,
      sensorFailures: failed.sensorFailures,
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("security posture");
    expect(warnings[0]).toContain("installed-App inventory");
    expect(warnings[0]).toContain("failed reads");
  });

  it("a scan where every sensor answered says nothing at all", async () => {
    const ok = await ingest({ securityPosture: () => Promise.resolve(ORG_POLICY) });
    const warnings = buildScanWarnings({
      detectorWarnings: [],
      hasToken: true,
      llmFailed: false,
      providerName: "gemini",
      explicitMock: false,
      snapshotTruncated: false,
      snapshotCoverage: 1,
      stackFit: null,
      prPartial: false,
      prFetchFailed: false,
      sensorFailures: ok.sensorFailures,
    });
    expect(warnings).toEqual([]);
  });
});

describe("the PR sensor keeps its own older channel", () => {
  it("a failed PR read sets prFetchFailed and stays OUT of sensorFailures", async () => {
    const failed = await ingest({ pullRequests: () => Promise.reject(new Error("graphql 500")) });
    expect(failed.prFetchFailed).toBe(true);
    expect(failed.sensorFailures).toEqual([]);
  });
});
