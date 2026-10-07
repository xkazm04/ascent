// The three DISPLAY-ONLY enrichments — commitActivity, prHeadInventory, guidanceFreshness — now fail
// through the module's single `sensorFailed` recorder instead of a bare `.catch(() => …)`. The recorder
// LOGS the failure (`[scan] <id> read failed:`) and returns the same degraded value the old catch did,
// but because these ids are not score-bearing sensors it must NOT add them to `sensorFailures` (that
// list persists as a scan caveat and feeds the D9 exclusions; a missing activity chart is neither).
// Pinned per id: the degraded value is unchanged, the log names the id, sensorFailures stays clean.
// Harness copied from scan-ingest.pr-heads.test.ts (a forge whose enrich() returns the given readers).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ingestRepository } from "./scan-ingest";
import type { AppInventory } from "@/lib/github/check-suites";
import type { EnrichmentSource, Forge } from "@/lib/forge/types";
import type { ParsedRepo, RepoSource } from "@/lib/github/source";
import type { PrStats, RepoSnapshot } from "@/lib/types";

const PARSED: ParsedRepo = { owner: "acme", repo: "r" };
// In pickGuidanceFiles' rank order (CLAUDE.md before AGENTS.md at the same depth).
const GUIDANCE = ["CLAUDE.md", "AGENTS.md"];

function snapshot(): RepoSnapshot {
  const files = [{ path: "README.md", content: "# r" }, ...GUIDANCE.map((path) => ({ path, content: "# guide" }))];
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

const ingest = (enrich: EnrichmentSource) =>
  ingestRepository({ parsed: PARSED, source, forge: forgeWith(enrich), token: "t", emit: () => {} });

let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  error = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => error.mockRestore());

/** The recorder's log line for `id`, carrying the original error. */
const logged = (id: string, err: unknown) =>
  expect(error).toHaveBeenCalledWith(expect.stringContaining(`${id} read failed`), err);

describe("ingestRepository — display-only enrichments fail through the recorder", () => {
  it("commitActivity: a thrown read resolves activityPromise to null, is logged, and is NOT a failed sensor", async () => {
    const boom = new Error("stats 202 forever");
    const result = await ingest({ commitActivity: () => Promise.reject(boom) });

    await expect(result.activityPromise).resolves.toBeNull();
    logged("commitActivity", boom);
    expect(result.sensorFailures).toEqual([]);
    expect(result.sensorFailures).not.toContain("commitActivity");
  });

  it("prHeadInventory: a thrown PR-head read sets prHeadTruncated, is logged, and is NOT a failed sensor", async () => {
    const boom = new Error("502 on PR head");
    const read = vi.fn(async (_o: string, _r: string, sha: string): Promise<AppInventory> => {
      if (sha === "pr1") throw boom;
      return { sha, apps: [{ slug: "claude", name: "claude", conclusion: "success" }], total: 1, truncated: false };
    });
    const pullRequests = () =>
      Promise.resolve({ stats: { analyzed: 1 } as PrStats, partial: false, aiChanges: [], prHeadShas: ["pr1"] });

    const result = await ingest({ pullRequests, appInventory: read });

    expect(result.appInventory?.prHeadTruncated).toBe(true);
    expect(result.appInventory?.apps.map((a) => a.slug)).toEqual(["claude"]); // the scored read stands
    logged("prHeadInventory", boom);
    expect(result.sensorFailures).toEqual([]);
  });

  it("guidanceFreshness: a thrown read degrades to per-file { path } only, is logged, and is NOT a failed sensor", async () => {
    const boom = new Error("commits?path= rate limited");
    const guidanceFreshness = vi.fn(() => Promise.reject(boom));

    const result = await ingest({ guidanceFreshness });

    const freshness = await result.guidanceFreshnessPromise;
    expect(freshness).toEqual(GUIDANCE.map((path) => ({ path }))); // freshness unknown, never "stale"
    expect(guidanceFreshness).toHaveBeenCalledWith(PARSED, "sha1", GUIDANCE, expect.objectContaining({ token: "t" }));
    logged("guidanceFreshness", boom);
    expect(result.sensorFailures).toEqual([]);
  });

  it("all three failing together still leave sensorFailures empty, with one log line each", async () => {
    const read = vi.fn(async (_o: string, _r: string, sha: string): Promise<AppInventory> => {
      if (sha !== "sha1") throw new Error("head");
      return { sha, apps: [], total: 0, truncated: false };
    });
    const result = await ingest({
      commitActivity: () => Promise.reject(new Error("a")),
      guidanceFreshness: () => Promise.reject(new Error("g")),
      pullRequests: () => Promise.resolve({ stats: { analyzed: 1 } as PrStats, partial: false, aiChanges: [], prHeadShas: ["pr1"] }),
      appInventory: read,
    });
    await result.activityPromise;
    await result.guidanceFreshnessPromise;

    expect(result.sensorFailures).toEqual([]);
    const lines = error.mock.calls.map((c) => String(c[0]));
    for (const id of ["commitActivity", "prHeadInventory", "guidanceFreshness"]) {
      expect(lines.filter((l) => l.includes(`${id} read failed`))).toHaveLength(1);
    }
  });

  it("guard: a score-bearing sensor through the same recorder DOES join sensorFailures (the contrast)", async () => {
    const boom = new Error("ci health 500");
    const result = await ingest({ ciHealth: () => Promise.reject(boom) });

    expect(result.ciHealth).toBeNull();
    expect(result.sensorFailures).toEqual(["ciHealth"]);
    logged("ciHealth", boom);
  });
});
