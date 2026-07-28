// getOrgGapAnalysis — the headline cross-repo call: is a weak dimension an ORG problem (systemic,
// fix once with a practice) or a REPO problem (one repo lagging what the fleet already handles)?
// It was the only export in org-insights.ts without a describe block, and its four thresholds
// (GAP_SCORE / COMMON_RATIO / OUTLIER_DELTA / HEALTHY_AVG) plus the new GAP_MIN_REPOS population
// floor decide which of two very different pieces of work a lead is told to fund. Boundary
// behavior is pinned here so a drift in any one of them fails loudly.
//
// Mirrors the mocking style of the sibling suites in org-insights.test.ts: a crafted prisma double
// driving the REAL function, and a distinct org slug per test (getOrgBySlug is `cache()`d).

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  withRetry: (fn: () => unknown) => fn(),
}));

import { GAP_MIN_REPOS, getOrgGapAnalysis } from "@/lib/db/org-insights";
import { PRACTICES } from "@/lib/practices";

/** `null` dims = a repo row with no scan at all (it must not count toward `scanned`). */
type FakeRepo = { name: string; dims: Record<string, number> | null };

function fakeGapPrisma(repos: FakeRepo[]) {
  return {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug: "gaps" })) },
    repository: {
      findMany: vi.fn(async () =>
        repos.map((r) => ({
          name: r.name,
          fullName: `gaps/${r.name}`,
          scans: r.dims ? [{ dimensions: Object.entries(r.dims).map(([dimId, score]) => ({ dimId, score })) }] : [],
        })),
      ),
    },
  };
}

/** Build a fleet where every repo carries the same single dimension, at the given scores. */
const oneDim = (dimId: string, scores: number[]): FakeRepo[] =>
  scores.map((score, i) => ({ name: String.fromCharCode(97 + i), dims: { [dimId]: score } }));

const run = (slug: string, repos: FakeRepo[]) => {
  mockGetPrisma.mockReturnValue(fakeGapPrisma(repos) as never);
  return getOrgGapAnalysis(slug);
};

beforeEach(() => {
  mockIsDbConfigured.mockReturnValue(true);
  mockGetPrisma.mockReset();
});

describe("getOrgGapAnalysis — the common-vs-repo-specific split", () => {
  it("routes a fleet-wide weakness to commonGaps and a lone laggard to repoSpecific — never both lists", async () => {
    // D1: 10/20/30/90 → 3 of 4 below GAP_SCORE (systemic), org avg 38 (below HEALTHY_AVG, so the
    //     90-scoring repo can't also be read as everyone else being "outliers").
    // D2: 80/80/80/50 → nobody weak, org avg 73, and `d` sits 23 below it (a repo problem).
    const a = await run("split-org", [
      { name: "a", dims: { D1: 10, D2: 80 } },
      { name: "b", dims: { D1: 20, D2: 80 } },
      { name: "c", dims: { D1: 30, D2: 80 } },
      { name: "d", dims: { D1: 90, D2: 50 } },
    ]);

    expect(a!.scanned).toBe(4);
    expect(a!.minRepos).toBe(GAP_MIN_REPOS);

    expect(a!.commonGaps.map((g) => g.dimId)).toEqual(["D1"]); // D2 is NOT a systemic gap
    expect(a!.commonGaps[0]).toMatchObject({ dimId: "D1", weakCount: 3, total: 4, avg: 38 });
    expect(a!.commonGaps[0].practiceId).toBe(PRACTICES.find((p) => p.dimId === "D1")!.id);
    expect(a!.commonGaps[0].exemplar).toEqual({ name: "d", fullName: "gaps/d", score: 90 });

    expect(a!.repoSpecific.map((r) => r.dimId)).toEqual(["D2"]); // D1 is NOT a repo-specific gap
    expect(a!.repoSpecific[0]).toMatchObject({ fullName: "gaps/d", name: "d", dimId: "D2", score: 50, orgAvg: 73, delta: 23 });
  });

  it("returns null when nothing in the scope has a scan, and never counts an unscanned repo", async () => {
    expect(await run("empty-org", [{ name: "a", dims: null }, { name: "b", dims: null }])).toBeNull();

    // 4 repo rows, only 3 scanned → the ratios must divide by 3, not 4: 2 of 3 weak = 0.67 ≥ 0.5.
    const a = await run("partial-org", [
      { name: "a", dims: { D1: 10 } },
      { name: "b", dims: { D1: 20 } },
      { name: "c", dims: { D1: 90 } },
      { name: "d", dims: null },
    ]);
    expect(a!.scanned).toBe(3);
    expect(a!.commonGaps[0]).toMatchObject({ weakCount: 2, total: 3 });
  });
});

describe("getOrgGapAnalysis — threshold boundaries", () => {
  it("GAP_SCORE is exclusive: a repo AT 45 is not weak, at 44 it is", async () => {
    // All four exactly at the threshold → zero weak repos → no systemic gap at all.
    const atThreshold = await run("gapscore-at", oneDim("D1", [45, 45, 45, 45]));
    expect(atThreshold!.commonGaps).toEqual([]);

    // Two below, two at → weakCount 2, which is also the COMMON_RATIO boundary below.
    const below = await run("gapscore-below", oneDim("D1", [44, 44, 45, 45]));
    expect(below!.commonGaps[0]).toMatchObject({ dimId: "D1", weakCount: 2, total: 4 });
  });

  it("COMMON_RATIO is inclusive at exactly half the repos, and one below half is not systemic", async () => {
    const exactlyHalf = await run("ratio-half", oneDim("D1", [10, 10, 90, 90])); // 2/4 = 0.50
    expect(exactlyHalf!.commonGaps.map((g) => g.dimId)).toEqual(["D1"]);

    const underHalf = await run("ratio-under", oneDim("D1", [10, 90, 90, 90])); // 1/4 = 0.25
    expect(underHalf!.commonGaps).toEqual([]);
  });

  it("OUTLIER_DELTA is inclusive at 18 below the org average and excludes 17", async () => {
    // 32/56/56/56 → org avg 50, `a` is exactly 18 below.
    const at18 = await run("delta-18", oneDim("D3", [32, 56, 56, 56]));
    expect(at18!.repoSpecific.map((r) => [r.name, r.delta])).toEqual([["a", 18]]);

    // 33/55/56/56 → org avg 50, `a` is 17 below → not far enough to single out.
    const at17 = await run("delta-17", oneDim("D3", [33, 55, 56, 56]));
    expect(at17!.repoSpecific).toEqual([]);
  });

  it("HEALTHY_AVG is inclusive at an org average of 50 and excludes 49 — a struggling org has no 'outlier'", async () => {
    // Same 18-point gap in both fleets; only the org average moves across the healthy line.
    const avg50 = await run("healthy-50", oneDim("D3", [32, 56, 56, 56])); // avg 50
    expect(avg50!.repoSpecific.map((r) => r.orgAvg)).toEqual([50]);

    const avg49 = await run("healthy-49", oneDim("D3", [31, 55, 55, 55])); // avg 49, `a` still 18 below
    expect(avg49!.repoSpecific).toEqual([]);
  });
});

describe("getOrgGapAnalysis — the exemplar rule", () => {
  it("names an exemplar only when the fleet's best repo actually clears 70", async () => {
    const noExemplar = await run("exemplar-69", oneDim("D1", [10, 10, 10, 69]));
    expect(noExemplar!.commonGaps[0]).toMatchObject({ weakCount: 3, exemplar: null }); // 69 is nobody's model

    const withExemplar = await run("exemplar-70", oneDim("D1", [10, 10, 10, 70]));
    expect(withExemplar!.commonGaps[0].exemplar).toEqual({ name: "d", fullName: "gaps/d", score: 70 });
  });

  it("picks the single highest scorer as the exemplar, not just any repo over the bar", async () => {
    const a = await run("exemplar-top", oneDim("D1", [10, 10, 75, 88]));
    expect(a!.commonGaps[0].exemplar).toMatchObject({ name: "d", score: 88 });
  });
});

describe("getOrgGapAnalysis — the GAP_MIN_REPOS population floor", () => {
  it("refuses to call a 2-repo fleet with ONE weak repo a systemic org gap", async () => {
    // The exact misread the floor exists for: 1 of 2 weak clears COMMON_RATIO = 0.5, so before the
    // guard this org was told to roll out a fleet-wide practice because a single repo was behind.
    const a = await run("tiny-org", oneDim("D1", [10, 90]));
    expect(a).toEqual({ scanned: 2, commonGaps: [], repoSpecific: [], minRepos: GAP_MIN_REPOS });
  });

  it("classifies nothing at all below the floor — neither half of the split is meaningful yet", async () => {
    const solo = await run("solo-org", oneDim("D1", [10]));
    expect(solo).toEqual({ scanned: 1, commonGaps: [], repoSpecific: [], minRepos: GAP_MIN_REPOS });

    // A 2-repo fleet can produce an "outlier" measured against an average it half-defines: 30/80 →
    // avg 55 ≥ HEALTHY_AVG and a 25-point delta. Suppressed too.
    const pair = await run("pair-org", oneDim("D3", [30, 80]));
    expect(pair!.repoSpecific).toEqual([]);
  });

  it("resumes classifying at exactly GAP_MIN_REPOS scanned repos", async () => {
    expect(GAP_MIN_REPOS).toBe(3); // the floor the guard, the panel copy, and these fixtures agree on
    const a = await run("floor-org", oneDim("D1", [10, 20, 90]));
    expect(a!.scanned).toBe(3);
    expect(a!.commonGaps[0]).toMatchObject({ dimId: "D1", weakCount: 2, total: 3 });
    expect(a!.commonGaps[0].exemplar).toMatchObject({ name: "c", score: 90 });
  });

  it("always reports the floor it measured against, so a surface can explain itself", async () => {
    const above = await run("floor-report", oneDim("D1", [10, 20, 30, 40]));
    expect(above!.minRepos).toBe(GAP_MIN_REPOS);
  });
});
