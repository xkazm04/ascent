// The App inventory reads suites on a bounded few recent PR HEADS, not only the scored commit.
//
// Row 12 (backlog develop-2026-09-17). An App configured in Settings that posts only on
// `pull_request` events (PR-only code scanning, a coverage reporter) never leaves a suite on the
// default-branch commit the scan scores, so `fetchAppInventory(scoredSha)` could not see it at all.
// The PR page ingestion already fetched carries each merged PR's head oid, so the heads are free; the
// extra cost is at most PR_HEAD_INVENTORY_CAP concurrent check-suite calls.
//
// What this file pins is mostly the INGEST half: the PR-head Apps land in `prHeadApps`, beside the
// scored commit's `apps`. The last case walks the join into the score: since r22 (row 42) a PR-only
// SAST App is credited by the D9 battery (security/checks.pr-heads.test.ts pins the credit rule).

import { describe, it, expect, vi } from "vitest";
import { ingestRepository } from "./scan-ingest";
import { buildScanScoreInput } from "./scan-score-input";
import { PR_HEAD_INVENTORY_CAP, type AppInventory } from "@/lib/github/check-suites";
import type { EnrichmentSource, Forge } from "@/lib/forge/types";
import type { ParsedRepo, RepoSource } from "@/lib/github/source";
import type { PrStats, RepoSnapshot } from "@/lib/types";

const PARSED: ParsedRepo = { owner: "acme", repo: "r" };

function snapshot(): RepoSnapshot {
  const files = [{ path: "README.md", content: "# r" }];
  return {
    meta: { owner: "acme", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main", headSha: "sha1" },
    tree: files.map((f) => ({ path: f.path, type: "blob" as const })),
    files: files.map((f) => ({ path: f.path, content: f.content, bytes: f.content.length })),
    commits: [{ message: "feat: x" }],
    truncated: false,
    coverage: 1,
  };
}

const source: RepoSource = { fetchSnapshot: async () => snapshot() };

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

const inv = (sha: string, slugs: string[]): AppInventory => ({
  sha,
  apps: slugs.map((slug) => ({ slug, name: slug, conclusion: "success" })),
  total: slugs.length,
  truncated: false,
});

/** A PR sensor that answered, carrying the given merged-PR head shas. */
const prs = (prHeadShas: string[]) => () =>
  Promise.resolve({ stats: { analyzed: 1 } as PrStats, partial: false, aiChanges: [], prHeadShas });

/** An inventory reader answering per sha from `bySha`; `throw` rejects that sha's read. */
function inventoryReader(bySha: Record<string, string[] | "throw">) {
  const calls: string[] = [];
  const read = vi.fn(async (_o: string, _r: string, sha: string) => {
    calls.push(sha);
    const v = bySha[sha];
    if (v === "throw") throw new Error("502");
    return inv(sha, v ?? []);
  });
  return { read, calls };
}

async function ingest(enrich: EnrichmentSource) {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    return await ingestRepository({ parsed: PARSED, source, forge: forgeWith(enrich), token: "t", emit: () => {} });
  } finally {
    quiet.mockRestore();
  }
}

describe("ingestRepository: the App inventory observes recent PR heads", () => {
  it("includes a slug observed ONLY on a recent PR head (empty scored-commit suites)", async () => {
    const { read } = inventoryReader({ sha1: [], pr1: ["github-code-scanning"] });
    const result = await ingest({ pullRequests: prs(["pr1"]), appInventory: read });
    expect(result.appInventory?.prHeadApps?.map((a) => a.slug)).toEqual(["github-code-scanning"]);
    expect(result.appInventory?.prHeadShas).toEqual(["pr1"]);
    expect(result.appInventory?.apps).toEqual([]); // the scored commit's list is unchanged
    expect(result.appInventory?.sha).toBe("sha1");
  });

  it("reads at most PR_HEAD_INVENTORY_CAP PR heads, most recent first, beside the one scored read", async () => {
    const { read, calls } = inventoryReader({});
    await ingest({ pullRequests: prs(["p1", "p2", "p3", "p4", "p5"]), appInventory: read });
    expect(calls).toHaveLength(1 + PR_HEAD_INVENTORY_CAP);
    expect(calls.slice(1)).toEqual(["p1", "p2", "p3"].slice(0, PR_HEAD_INVENTORY_CAP));
  });

  it("never re-reads the scored commit as a PR head (a fast-forward merge shares the sha)", async () => {
    const { read, calls } = inventoryReader({});
    await ingest({ pullRequests: prs(["SHA1", "pr1"]), appInventory: read });
    expect(calls).toEqual(["sha1", "pr1"]);
  });

  it("a thrown PR-head read marks the list a floor and is NOT a failed sensor", async () => {
    const { read } = inventoryReader({ sha1: ["claude"], pr1: "throw", pr2: ["codecov"] });
    const result = await ingest({ pullRequests: prs(["pr1", "pr2"]), appInventory: read });
    expect(result.sensorFailures).toEqual([]);
    expect(result.appInventory?.prHeadTruncated).toBe(true);
    expect(result.appInventory?.prHeadApps?.map((a) => a.slug)).toEqual(["codecov"]);
    expect(result.appInventory?.apps.map((a) => a.slug)).toEqual(["claude"]);
  });

  it("guard: no PR page means exactly one inventory read and no prHead keys", async () => {
    const { read, calls } = inventoryReader({ sha1: ["claude"] });
    const result = await ingest({ appInventory: read });
    expect(calls).toEqual(["sha1"]);
    expect(result.appInventory).toEqual(inv("sha1", ["claude"]));
  });

  it("guard: a failed PR read degrades to the single scored read", async () => {
    const { read, calls } = inventoryReader({});
    const result = await ingest({ pullRequests: () => Promise.reject(new Error("gql")), appInventory: read });
    expect(calls).toEqual(["sha1"]);
    expect(result.prFetchFailed).toBe(true);
  });

  it("guard: a failed SCORED read stays null and a failed sensor, whatever the PR heads say", async () => {
    const { read } = inventoryReader({ sha1: "throw", pr1: ["github-code-scanning"] });
    const result = await ingest({ pullRequests: prs(["pr1"]), appInventory: read });
    expect(result.appInventory).toBeNull();
    expect(result.sensorFailures).toEqual(["appInventory"]);
  });

  it("a PR-only SAST App read at ingest is credited by the D9 battery (r22)", async () => {
    const score = async (heads: string[]) => {
      const { read } = inventoryReader({ sha1: [], pr1: ["github-code-scanning"] });
      const r = await ingest({ pullRequests: prs(heads), appInventory: read });
      const { scoreInput } = await buildScanScoreInput({
        snapshot: r.snapshot, prStats: r.prStats, governance: r.governance, securityPosture: r.securityPosture,
        securityExposure: r.securityExposure, appInventory: r.appInventory, ciHealth: r.ciHealth,
        sensorFailures: r.sensorFailures, now: "2026-06-02T00:00:00Z",
      });
      return scoreInput.securityAssessment!.checks.find((c) => c.id === "sast")!.score;
    };
    expect(await score([])).toBeNull(); // no workflows and no App: n/a, as before
    expect(await score(["pr1"])).toBe(10);
  });
});
