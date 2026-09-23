// getOrgPrSignals passes each repo's review-integrity counts (the rate book's selfApproved and
// fastApproval entries) through on PrRepoRow.integrity, and does nothing else with them: review
// coverage, its basis and the riskiest-first order are exactly what master published at 9497d192
// (pooled review coverage) whether or not the book carries the two integrity entries.

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

const integrityBook = (self: [number, number], fast: [number, number]): PrRateBook => ({
  selfApproved: qualifiedRate("selfApproved", ...self),
  fastApproval: qualifiedRate("fastApproval", ...fast),
});

/** The same two repos the pooled test uses: A 1 of 10 reviewed at 100 analyzed, B 10 of 10 at 10. */
const repoA = (extra: PrRateBook = {}) =>
  prStats({ analyzed: 100, reviewedRate: 10, rates: { reviewed: qualifiedRate("reviewed", 1, 10), ...extra } });
const repoB = (extra: PrRateBook = {}) =>
  prStats({ analyzed: 10, reviewedRate: 100, rates: { reviewed: qualifiedRate("reviewed", 10, 10), ...extra } });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("getOrgPrSignals review-integrity pass-through", () => {
  it("carries each repo's selfApproved / fastApproval counts on PrRepoRow.integrity", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([repoA(integrityBook([2, 10], [3, 9])), repoB(integrityBook([0, 10], [9, 10]))]));
    const res = await getOrgPrSignals("acme");
    const byName = new Map(res!.perRepo.map((r) => [r.name, r]));
    expect(byName.get("r0")!.integrity).toEqual({ selfApproved: { count: 2, population: 10 }, fastApproval: { count: 3, population: 9 } });
    expect(byName.get("r1")!.integrity).toEqual({ selfApproved: { count: 0, population: 10 }, fastApproval: { count: 9, population: 10 } });
  });

  it("guard: a pre-contract blob gets integrity {selfApproved: null, fastApproval: null} and nothing else moves", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma([prStats({ analyzed: 40 })]));
    const res = await getOrgPrSignals("acme");
    const { integrity, ...rest } = res!.perRepo[0]!;
    expect(integrity).toEqual({ selfApproved: null, fastApproval: null });
    expect(rest).toEqual({
      fullName: "acme/r0",
      name: "r0",
      analyzed: 40,
      mergeRate: 80,
      reviewedRate: 60,
      smallPrRate: 70,
      aiInvolvedRate: 30,
      aiGovernedRate: 50,
      medianHoursToMerge: 12,
      revertRate: 1,
      medianHoursToFirstReview: 4,
      aiTrailerRate: null,
      aiPreReviewedRate: null,
      population: { smallPr: 40, aiInvolved: 40, revert: 40, merge: 10, aiTrailer: 8, aiPreReviewed: 8 },
    });
  });

  it("guard: a garbage integrity entry reads as not persisted, never NaN", async () => {
    const bad = { selfApproved: { count: "x", population: 10 }, fastApproval: { count: 12, population: 10 } } as unknown as PrRateBook;
    mockGetPrisma.mockReturnValue(fakePrisma([repoA(bad)]));
    expect((await getOrgPrSignals("acme"))!.perRepo[0]!.integrity).toEqual({ selfApproved: null, fastApproval: null });
  });

  it("guard: avgReviewedRate, its basis and the perRepo order are identical with and without the integrity entries", async () => {
    const read = async (blobs: string[]) => {
      mockGetPrisma.mockReturnValue(fakePrisma(blobs));
      const res = (await getOrgPrSignals("acme"))!;
      return { rate: res.avgReviewedRate, basis: res.rateBasis.reviewed, order: res.perRepo.map((r) => [r.name, r.reviewedRate]) };
    };
    const without = await read([repoB(), repoA()]);
    const withBook = await read([repoB(integrityBook([0, 10], [9, 10])), repoA(integrityBook([2, 10], [3, 9]))]);
    // Master at 9497d192 publishes pooled 11 of 20 = 55, riskiest first.
    expect(without).toEqual({
      rate: 55,
      basis: { method: "pooled", weight: 110, repos: 2, count: 11, population: 20, legacyRepos: 0 },
      order: [["r1", 10], ["r0", 100]],
    });
    expect(withBook).toEqual(without);
  });
});
