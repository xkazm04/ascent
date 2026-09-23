// getOrgPrSignals pools the analyzer's rate book: a fleet review-coverage figure is the share of
// the fleet's human-merged PRs that were approved, not a mean of per-repo percentages weighted by
// `analyzed` (a volume proxy the rate is not denominated in). Blobs without the book keep the old
// arithmetic, so a legacy fleet does not move until it rescans. The shared fakePrisma pattern is
// the one org-signals.test.ts uses.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrStats } from "@/lib/types";
import { qualifiedRate, type PrRateBook } from "@/lib/analyze/pr-thresholds";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  withRetry: (fn: () => unknown) => fn(),
}));

import { getOrgPrSignals } from "./org-signals";

function fakePrisma(blobs: string[]) {
  const repos = blobs.map((raw, i) => ({ fullName: `acme/r${i}`, name: `r${i}`, scans: [{ prStats: raw }] }));
  return {
    organization: { findUnique: vi.fn(async () => ({ id: "org_1", slug: "acme", timezone: null })) },
    repository: { findMany: vi.fn(async () => repos) },
  };
}

function prStats(over: Partial<PrStats> = {}): string {
  const base: PrStats = {
    analyzed: 10,
    totalCount: 100,
    open: 0,
    merged: 8,
    closedUnmerged: 2,
    mergeRate: 80,
    reviewedRate: 60,
    avgReviews: 1,
    avgComments: 2,
    medianHoursToMerge: 12,
    medianHoursToFirstReview: 4,
    avgLineChanges: 150,
    avgChangedFiles: 5,
    smallPrRate: 70,
    botAuthoredRate: 10,
    aiInvolvedRate: 30,
    aiGovernedRate: 50,
    revertRate: 1,
    draftRate: 5,
    tools: [],
  };
  return JSON.stringify({ ...base, ...over });
}

const book = (entries: PrRateBook): { rates: PrRateBook } => ({ rates: entries });

/** Repo A (100 analyzed, 1 of 10 human merges approved) and repo B (10 analyzed, 10 of 10). */
const repoA = (extra: PrRateBook = {}) =>
  prStats({ analyzed: 100, reviewedRate: 10, mergeRate: 90, aiTrailerRate: 20, ...book({ reviewed: qualifiedRate("reviewed", 1, 10), ...extra }) });
const repoB = (extra: PrRateBook = {}) =>
  prStats({ analyzed: 10, reviewedRate: 100, mergeRate: 50, aiTrailerRate: 60, ...book({ reviewed: qualifiedRate("reviewed", 10, 10), ...extra }) });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getOrgPrSignals pooled fleet rates", () => {
  it("case 1: review coverage is 11 of 20 human-merged PRs (55), not the weighted 18", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([repoA(), repoB()]));
    const res = await getOrgPrSignals("acme");
    expect(res!.avgReviewedRate).toBe(55);
    expect(res!.rateBasis.reviewed).toMatchObject({ method: "pooled", count: 11, population: 20, repos: 2 });
  });

  it("case 2: AI governance pools 12 of 16 (75), not 54", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        prStats({ analyzed: 100, aiGovernedRate: 50, ...book({ aiGoverned: qualifiedRate("aiGoverned", 3, 6) }) }),
        prStats({ analyzed: 10, aiGovernedRate: 90, ...book({ aiGoverned: qualifiedRate("aiGoverned", 9, 10) }) }),
      ]),
    );
    const res = await getOrgPrSignals("acme");
    expect(res!.avgAiGovernedRate).toBe(75);
    expect(res!.rateBasis.aiGoverned).toMatchObject({ method: "pooled", count: 12, population: 16 });
  });

  it("case 3: the RATE_BASIS floor applies to the pooled population", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        prStats({ reviewedRate: null, ...book({ reviewed: qualifiedRate("reviewed", 1, 2) }) }),
        prStats({ reviewedRate: null, ...book({ reviewed: qualifiedRate("reviewed", 4, 4) }) }),
      ]),
    );
    expect((await getOrgPrSignals("acme"))!.avgReviewedRate).toBe(83);

    mockGetPrisma.mockReturnValue(
      fakePrisma([
        prStats({ reviewedRate: null, ...book({ reviewed: qualifiedRate("reviewed", 1, 2) }) }),
        prStats({ reviewedRate: null, ...book({ reviewed: qualifiedRate("reviewed", 1, 2) }) }),
      ]),
    );
    const under = await getOrgPrSignals("acme");
    expect(under!.avgReviewedRate).toBeNull();
    expect(under!.rateBasis.reviewed).toMatchObject({ method: "pooled", population: 4 });
  });

  it("case 4: blobs with no rate book keep the analyzed-weighted numbers and say so", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([prStats({ analyzed: 100, reviewedRate: 10 }), prStats({ analyzed: 10, reviewedRate: 100 })]));
    const res = await getOrgPrSignals("acme");
    expect(res!.avgReviewedRate).toBe(18);
    for (const id of ["reviewed", "smallPr", "aiInvolved", "aiGoverned", "revert"] as const) {
      expect(res!.rateBasis[id].method).toBe("volume-weighted");
      expect(res!.rateBasis[id].legacyRepos).toBe(2);
    }
  });

  it("case 5: a mixed fleet stays volume-weighted for that rate and counts the legacy repo", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([repoA(), prStats({ analyzed: 10, reviewedRate: 100 })]));
    const res = await getOrgPrSignals("acme");
    expect(res!.avgReviewedRate).toBe(18);
    expect(res!.rateBasis.reviewed).toMatchObject({ method: "volume-weighted", legacyRepos: 1 });
  });

  it("guard: merge / aiTrailer / aiPreReviewed keep the analyzed weighting and carry no method", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([repoA(), repoB()]));
    const res = await getOrgPrSignals("acme");
    expect(res!.avgMergeRate).toBe(86); // round((90*100 + 50*10) / 110)
    expect(res!.avgAiTrailerRate).toBe(24); // round((20*100 + 60*10) / 110)
    for (const id of ["merge", "aiTrailer", "aiPreReviewed"] as const) expect(res!.rateBasis[id].method).toBeUndefined();
  });

  it("guard: populations proportional to analyzed publish the same numbers as the weighting", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma([
        prStats({ analyzed: 10, smallPrRate: 70, ...book({ smallPr: qualifiedRate("smallPr", 7, 10) }) }),
        prStats({ analyzed: 30, smallPrRate: 40, ...book({ smallPr: qualifiedRate("smallPr", 12, 30) }) }),
      ]),
    );
    const res = await getOrgPrSignals("acme");
    expect(res!.rateBasis.smallPr.method).toBe("pooled");
    expect(res!.avgSmallPrRate).toBe(48); // weighted (700 + 1200) / 40 = 47.5 and pooled 19 / 40 agree
  });

  it("guard: perRepo order and every per-repo rate are untouched", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([repoB(), repoA()]));
    const res = await getOrgPrSignals("acme");
    expect(res!.perRepo.map((r) => [r.name, r.reviewedRate, r.analyzed])).toEqual([
      ["r1", 10, 100], // riskiest (lowest coverage) first
      ["r0", 100, 10],
    ]);
  });
});
