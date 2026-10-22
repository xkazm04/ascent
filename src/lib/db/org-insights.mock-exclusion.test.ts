// A mock-floor LATEST scan leaves the Practice Library and the gap analysis (rollups-0,
// challenge-2026-10-22). getOrgRollup has excluded a mock-scored repo from every number it presents as
// a measurement since commit 6c281275 (`realScored`, org-rollup.ts), and the badge on the same page
// counts that population. getOrgPractices and getOrgGapAnalysis selected no engineProvider at all, so a
// repo whose latest scan was the deterministic mock (src/lib/llm/mock.ts emits dimension rows) fed
// byDim, exemplars, gapRepos and commonGaps: a placeholder floor reported as an org gap beside a badge
// that refuses it. Both now apply the same predicate, through the latest-scan door.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({ mockIsDbConfigured: vi.fn(() => true), mockGetPrisma: vi.fn() }));

// The readers pick each repo's latest scan through the door (org-rollup-latest-scans.ts); this adapter
// serves the nested `scans: [latest]` fixtures below as the Scan table that door reads.
vi.mock("@/lib/db/client", async () => {
  const { servingNestedScans } = await import("./org-rollup-latest-scans.test-helpers");
  return {
    isDbConfigured: mockIsDbConfigured,
    getPrisma: (...a: unknown[]) => servingNestedScans(mockGetPrisma(...a)),
    withRetry: (fn: () => unknown) => fn(),
  };
});

import { getOrgGapAnalysis, getOrgPractices } from "@/lib/db/org-insights";
import { PRACTICES } from "@/lib/practices";

type Fixture = { name: string; engine: string; dims: Record<string, number> };

function fakePrisma(slug: string, repos: Fixture[]) {
  return {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug })) },
    improvementPr: { findMany: vi.fn(async () => []) },
    repository: {
      findMany: vi.fn(async () =>
        repos.map((r, i) => ({
          id: `repo_${i}`,
          name: r.name,
          fullName: `${slug}/${r.name}`,
          // Every repo also carries an OLDER live scan: a mock-latest repo is dropped, never swapped for
          // its last live scan (that would move the snapshot instant).
          scans: [
            { engineProvider: r.engine, dimensions: Object.entries(r.dims).map(([dimId, score]) => ({ dimId, score })) },
            { engineProvider: "anthropic", dimensions: Object.keys(r.dims).map((dimId) => ({ dimId, score: 99 })) },
          ],
        })),
      ),
    },
  };
}

const all = (score: number) => ({ D1: score, D2: score, D3: score, D4: score });
const mockRepos = (n: number, score: number): Fixture[] => Array.from({ length: n }, (_, i) => ({ name: `mock${i}`, engine: "mock", dims: all(score) }));
const liveRepos = (n: number, score: number): Fixture[] => Array.from({ length: n }, (_, i) => ({ name: `live${i}`, engine: "anthropic", dims: all(score) }));

beforeEach(() => {
  mockIsDbConfigured.mockReturnValue(true);
  mockGetPrisma.mockReset();
});

describe("getOrgGapAnalysis - a mock-latest repo is not part of the measured population", () => {
  it("4 mock-latest repos at 20 + 3 live repos at 80 -> scanned 3, no common gap, no mock repo as an outlier", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma("gap-mock", [...mockRepos(4, 20), ...liveRepos(3, 80)]));
    const g = await getOrgGapAnalysis("gap-mock");
    expect(g!.scanned).toBe(3);
    expect(g!.commonGaps).toEqual([]);
    expect(g!.repoSpecific.filter((r) => r.name.startsWith("mock"))).toEqual([]);
  });

  it("an all-mock fleet is an unscanned fleet (null), not a fleet of floor-level gaps", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma("gap-allmock", mockRepos(5, 20)));
    expect(await getOrgGapAnalysis("gap-allmock")).toBeNull();
  });
});

describe("getOrgPractices - the same realScored predicate getOrgRollup applies", () => {
  it("a mock-latest repo scoring 10 on D1 is absent from gapRepos/gapRepoRefs, and total counts live repos only", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prax-mock", [
        { name: "placeholder", engine: "mock", dims: { D1: 10 } },
        { name: "alpha", engine: "anthropic", dims: { D1: 85 } },
        { name: "beta", engine: "anthropic", dims: { D1: 30 } },
      ]),
    );
    const d1 = PRACTICES.find((p) => p.dimId === "D1")!;
    const practice = (await getOrgPractices("prax-mock"))!.find((p) => p.id === d1.id)!;
    expect(practice.total).toBe(2);
    expect(practice.gapRepos).toEqual(["beta"]);
    expect(practice.gapRepoRefs).toEqual([{ name: "beta", fullName: "prax-mock/beta" }]);
    expect(practice.exemplar?.name).toBe("alpha");
  });

  it("a mock-latest repo is never an exemplar, however high its placeholder score", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prax-mockhigh", [
        { name: "placeholder", engine: "mock", dims: { D1: 100 } },
        { name: "alpha", engine: "anthropic", dims: { D1: 40 } },
      ]),
    );
    const d1 = PRACTICES.find((p) => p.dimId === "D1")!;
    const practice = (await getOrgPractices("prax-mockhigh"))!.find((p) => p.id === d1.id)!;
    expect(practice.exemplar).toBeNull();
    expect(practice.total).toBe(1);
  });
});
