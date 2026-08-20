// Resilience of the JSON-blob signal aggregators (getOrgPrSignals / getOrgGovernance / getOrgActivity).
// Each JSON.parse's per-repo blobs persisted by earlier scans and folds them into fleet headline
// rates under a bare `catch {}`. These tests pin that a malformed/non-JSON/null blob is SKIPPED
// (never throws, never corrupts the denominator), a partial blob contributes only its present fields
// with no NaN/undefined leak, a well-formed set aggregates to correct totals, and an all-bad/empty
// input returns the documented `null` — not a crash.

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrStats } from "@/lib/types";
import { qualifiedRate } from "@/lib/analyze/pr-thresholds";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  withRetry: (fn: () => unknown) => fn(),
}));

import { getOrgPrSignals, getOrgGovernance, getOrgActivity } from "./org-signals";

/**
 * Fake prisma matching the shape all three aggregators read: organization.findUnique returns the org
 * row, repository.findMany returns one row per repo whose `scans` array is the take:1 latest scan
 * carrying the requested blob column (prStats | governance | commitActivity).
 *
 * Each entry in `repoBlobs` becomes one repo. `null` models a repo with no scan / no blob (the
 * `scans[0]?.<col>` falsy branch); a string is the stored raw blob (valid OR deliberately corrupt).
 * `extra` lets the governance fake also carry fullName/name without bloating the call sites.
 */
function fakePrisma(
  column: "prStats" | "governance" | "commitActivity",
  repoBlobs: Array<string | null>,
  opts: { org?: boolean; extra?: (i: number) => Record<string, unknown>; scannedAt?: (i: number) => Date; timezone?: string | null } = {},
) {
  // `timezone` is the org's CANONICAL ZONE column (Organization.timezone): null = inherit the
  // deployment default (UTC here), which is what every org row looked like before the column existed.
  const orgRow = opts.org === false ? null : { id: "org_1", slug: "acme", timezone: opts.timezone ?? null };
  // getOrgActivity reads scannedAt to anchor each commit series to a calendar week. Default every
  // repo to the SAME fixed week so the legacy tests describe the same-cadence (right-aligned) case;
  // a test can override per-repo via opts.scannedAt to exercise heterogeneous cadences.
  const defaultScan = new Date("2026-06-17T00:00:00Z");
  const repos = repoBlobs.map((raw, i) => ({
    ...(opts.extra ? opts.extra(i) : {}),
    scans: raw === null ? [] : [{ [column]: raw, scannedAt: opts.scannedAt ? opts.scannedAt(i) : defaultScan }],
  }));
  return {
    organization: { findUnique: vi.fn(async () => orgRow) },
    repository: { findMany: vi.fn(async () => repos) },
  };
}

/** A complete, well-formed PrStats blob; override only the fields a test cares about. */
function prStats(over: Partial<PrStats> = {}): string {
  const base: PrStats = {
    analyzed: 10,
    totalCount: 100,
    open: 5,
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
    tools: [{ name: "copilot", count: 3 }],
  };
  return JSON.stringify({ ...base, ...over });
}

function gov(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    protected: true,
    requiresPullRequest: true,
    requiredApprovals: 1,
    requiresStatusChecks: true,
    requiresSignatures: false,
    ruleCount: 3,
    readable: true,
    ...over,
  });
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

// ── getOrgPrSignals ───────────────────────────────────────────────────────────

describe("getOrgPrSignals blob resilience", () => {
  it("a well-formed set aggregates to correct totals", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 10, mergeRate: 80, smallPrRate: 70, aiInvolvedRate: 30, medianHoursToMerge: 10 }),
        prStats({ analyzed: 20, mergeRate: 60, smallPrRate: 50, aiInvolvedRate: 10, medianHoursToMerge: 20 }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    expect(res).not.toBeNull();
    expect(res!.repos).toBe(2);
    expect(res!.totalPrs).toBe(30); // 10 + 20
    // Analyzed-weighted (the 20-PR repo outweighs the 10-PR repo), NOT an equal-weight mean.
    expect(res!.avgMergeRate).toBe(67); // (80·10 + 60·20)/30 = 66.7 → 67 (unweighted mean would be 70)
    expect(res!.avgSmallPrRate).toBe(57); // (70·10 + 50·20)/30 = 56.7 → 57
    expect(res!.avgAiInvolvedRate).toBe(17); // (30·10 + 10·20)/30 = 16.7 → 17
    expect(res!.typicalHoursToMerge).toBe(15); // mean(10,20) — median-of-medians, left unweighted
    // tools summed across repos (both contribute copilot:3)
    expect(res!.tools).toEqual([{ name: "copilot", count: 6 }]);
  });

  it("malformed / non-JSON / null blobs are skipped and do NOT corrupt the aggregate", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 10, mergeRate: 80 }),
        "{ not json at all",      // malformed → JSON.parse throws → caught
        "not even close",          // non-JSON garbage
        null,                       // no scan / no blob
        prStats({ analyzed: 20, mergeRate: 60 }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    // Only the two valid rows count: denominator = 2, not 5.
    expect(res).not.toBeNull();
    expect(res!.repos).toBe(2);
    expect(res!.totalPrs).toBe(30);
    expect(res!.avgMergeRate).toBe(67); // analyzed-weighted (80·10 + 60·20)/30, GOOD rows only, not skewed by NaN
    expect(Number.isFinite(res!.avgMergeRate)).toBe(true);
  });

  it("a zero-PR (analyzed:0) row is excluded from the rate denominators", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 0, mergeRate: 0 }), // filtered out by `analyzed > 0`
        prStats({ analyzed: 10, mergeRate: 90 }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    expect(res!.repos).toBe(1);
    expect(res!.totalPrs).toBe(10);
    expect(res!.avgMergeRate).toBe(90); // the 0% repo must not drag the mean to 45
  });

  it("partial blobs: null reviewedRate/aiGovernedRate/median contribute nothing, no NaN leaks", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 10, reviewedRate: 60, aiGovernedRate: 40, medianHoursToMerge: 10 }),
        prStats({ analyzed: 10, reviewedRate: null, aiGovernedRate: null, medianHoursToMerge: null }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    // The null-sampled repo is dropped from those three means (sample-aware), not counted as 0.
    expect(res!.avgReviewedRate).toBe(60);
    expect(res!.avgAiGovernedRate).toBe(40);
    expect(res!.typicalHoursToMerge).toBe(10);
    expect(Number.isNaN(res!.avgReviewedRate as number)).toBe(false);
  });

  it("all-invalid / empty input returns null (documented empty shape, not a throw)", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma("prStats", ["{bad", "also bad", null]));
    await expect(getOrgPrSignals("acme")).resolves.toBeNull();

    mockGetPrisma.mockReturnValue(fakePrisma("prStats", []));
    await expect(getOrgPrSignals("acme")).resolves.toBeNull();
  });
});

// ── getOrgPrSignals: per-repo drill-down rows ─────────────────────────────────
//
// The delivery tab's "By repository" table reads perRepo. Pin that rows carry the repo identity
// (fullName/name from the query, not the blob), that ordering is riskiest-first (lowest measured
// review coverage leads; a null "no human-merged sample" sorts AFTER every measured rate — it is
// absence, not 0% coverage), and that slower merges break ties.

describe("getOrgPrSignals perRepo rows", () => {
  it("builds identity-carrying rows sorted riskiest-first (nulls after measured, hours break ties)", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma(
        "prStats",
        [
          prStats({ reviewedRate: 90, medianHoursToMerge: 5 }),
          prStats({ reviewedRate: null, medianHoursToMerge: 99 }), // no sample → last, despite slow merges
          prStats({ reviewedRate: 40, medianHoursToMerge: 10 }),
          prStats({ reviewedRate: 40, medianHoursToMerge: 30 }), // ties with row above → slower first
        ],
        { extra: (i) => ({ fullName: `acme/repo-${i}`, name: `repo-${i}` }) },
      ),
    );

    const res = await getOrgPrSignals("acme");

    expect(res!.perRepo.map((r) => r.name)).toEqual(["repo-3", "repo-2", "repo-0", "repo-1"]);
    expect(res!.perRepo[0]).toMatchObject({
      fullName: "acme/repo-3",
      analyzed: 10,
      mergeRate: 80,
      reviewedRate: 40,
      medianHoursToMerge: 30,
    });
  });

  it("skips malformed/zero-PR blobs in perRepo exactly like the aggregate does", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [prStats(), "{bad", prStats({ analyzed: 0 }), null], {
        extra: (i) => ({ fullName: `acme/repo-${i}`, name: `repo-${i}` }),
      }),
    );

    const res = await getOrgPrSignals("acme");

    expect(res!.perRepo).toHaveLength(1);
    expect(res!.perRepo[0].fullName).toBe("acme/repo-0");
  });
});

// ── getOrgPrSignals: null-vs-zero "no sample" semantics ───────────────────────
//
// The dashboard must distinguish "we have NO data for this metric" (render a dash) from
// "we measured a genuine zero" (render 0%). The sample-aware means (reviewedRate,
// aiGovernedRate, medianHoursToMerge) collapse to `null` when no repo carries that field,
// but stay numeric — including a real `0` — when at least one sample exists. The always-
// present rates (mergeRate / smallPrRate / aiInvolvedRate) must report a measured all-zero
// fleet as `0`, never `null`. These tests pin that the UI can say "no data" vs "0%" honestly.

describe("getOrgPrSignals null-vs-zero (no-sample) semantics", () => {
  it('NO sample for a metric → null (not 0): every repo has null reviewed/governed/median', async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 10, reviewedRate: null, aiGovernedRate: null, medianHoursToMerge: null }),
        prStats({ analyzed: 20, reviewedRate: null, aiGovernedRate: null, medianHoursToMerge: null }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    expect(res).not.toBeNull();
    expect(res!.repos).toBe(2); // the repos themselves still count for present fields
    // No sample anywhere → "no data" dash, encoded as null, NOT a fabricated 0.
    expect(res!.avgReviewedRate).toBeNull();
    expect(res!.avgAiGovernedRate).toBeNull();
    expect(res!.typicalHoursToMerge).toBeNull();
    expect(res!.avgReviewedRate).not.toBe(0); // the regression we guard against
  });

  it('a genuine measured 0 → 0 (not null): every repo measured exactly 0', async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({
          analyzed: 10,
          reviewedRate: 0, // measured: nothing was reviewed
          aiGovernedRate: 0, // measured: nothing was AI-governed
          medianHoursToMerge: 0, // measured: merged instantly
          mergeRate: 0,
          smallPrRate: 0,
          aiInvolvedRate: 0,
        }),
        prStats({
          analyzed: 5,
          reviewedRate: 0,
          aiGovernedRate: 0,
          medianHoursToMerge: 0,
          mergeRate: 0,
          smallPrRate: 0,
          aiInvolvedRate: 0,
        }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    expect(res).not.toBeNull();
    // Real zeros are DATA: they must surface as 0, distinct from the null "no sample" above.
    expect(res!.avgReviewedRate).toBe(0);
    expect(res!.avgAiGovernedRate).toBe(0);
    expect(res!.typicalHoursToMerge).toBe(0);
    expect(res!.avgReviewedRate).not.toBeNull();
    // Always-present rates: a measured all-zero fleet reads 0%, never null.
    expect(res!.avgMergeRate).toBe(0);
    expect(res!.avgSmallPrRate).toBe(0);
    expect(res!.avgAiInvolvedRate).toBe(0);
  });

  it('a MIX of null-sample and numeric → mean over only the sampled repos (null ones ignored, not counted as 0)', async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 10, reviewedRate: 80, aiGovernedRate: 60, medianHoursToMerge: 8 }),
        prStats({ analyzed: 10, reviewedRate: 40, aiGovernedRate: 20, medianHoursToMerge: 12 }),
        prStats({ analyzed: 10, reviewedRate: null, aiGovernedRate: null, medianHoursToMerge: null }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    // Denominator for sample-aware means = 2 (the sampled repos), NOT 3.
    expect(res!.avgReviewedRate).toBe(60); // mean(80,40) — a 0-treated null would give 40
    expect(res!.avgAiGovernedRate).toBe(40); // mean(60,20) — not mean(60,20,0)=27
    expect(res!.typicalHoursToMerge).toBe(10); // mean(8,12)
    expect(res!.repos).toBe(3); // all three repos still counted for present-field totals
  });

  it('a real 0 sample mixed with a real positive sample → the 0 IS averaged in (it is data, not absence)', async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 10, reviewedRate: 100, aiGovernedRate: 100 }),
        prStats({ analyzed: 10, reviewedRate: 0, aiGovernedRate: 0 }), // measured zero, present sample
      ]),
    );

    const res = await getOrgPrSignals("acme");

    // The measured 0 pulls the mean down — distinct from a null which would be dropped.
    expect(res!.avgReviewedRate).toBe(50); // mean(100,0), NOT 100 (which a dropped-null would give)
    expect(res!.avgAiGovernedRate).toBe(50);
  });
});

// ── getOrgPrSignals: volume-weighted fleet rates (fleet-rollups-insights #3) ──────────────────
//
// A "fleet rate" is analyzed-PR-weighted, not an average-of-per-repo-rates: a 1-PR toy repo must not
// count as much as a 500-PR flagship. These pin that the weighting is applied (so a tiny repo can't
// inflate/deflate the headline) and that nullable "no sample" rates carry no weight.

describe("getOrgPrSignals volume-weighted fleet rates", () => {
  it("weights each repo's rate by analyzed PRs, so a tiny repo can't dominate the fleet rate", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 1, mergeRate: 100, smallPrRate: 100, aiInvolvedRate: 100 }), // toy repo
        prStats({ analyzed: 9, mergeRate: 50, smallPrRate: 50, aiInvolvedRate: 50 }),     // flagship
      ]),
    );

    const res = await getOrgPrSignals("acme");

    // Weighted (100·1 + 50·9)/10 = 55, NOT the average-of-averages 75 the toy repo would inflate it to.
    expect(res!.avgMergeRate).toBe(55);
    expect(res!.avgSmallPrRate).toBe(55);
    expect(res!.avgAiInvolvedRate).toBe(55);
    expect(res!.avgMergeRate).not.toBe(75); // the average-of-averages regression this fix removes
  });

  it("weights nullable rates over only the SAMPLED repos (a null 'no sample' repo carries no weight)", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 1, reviewedRate: 100, aiGovernedRate: 100 }),
        prStats({ analyzed: 9, reviewedRate: 50, aiGovernedRate: 50 }),
        prStats({ analyzed: 100, reviewedRate: null, aiGovernedRate: null }), // huge, but no sample → 0 weight
      ]),
    );

    const res = await getOrgPrSignals("acme");

    // The null-sample flagship contributes NO weight; weighted over the two sampled repos = (100·1+50·9)/10 = 55.
    expect(res!.avgReviewedRate).toBe(55);
    expect(res!.avgAiGovernedRate).toBe(55);
  });
});

// ── getOrgPrSignals: W1a surfaced blob metrics (revert rate + review latency) ─────────────────
//
// revertRate / medianHoursToFirstReview were computed and persisted by every scan but never
// aggregated. They follow the exact discipline of their siblings: analyzed-weighted rate /
// mean-of-medians duration, and — the part these tests exist for — a HISTORICAL blob written
// before the fields existed contributes nothing (null, never a fabricated 0 or NaN).

/** A blob as an old scan persisted it: the W1a fields simply don't exist as keys. */
function legacyPrStats(over: Partial<PrStats> = {}): string {
  const o = JSON.parse(prStats(over)) as Record<string, unknown>;
  delete o.revertRate;
  delete o.medianHoursToFirstReview;
  return JSON.stringify(o);
}

describe("getOrgPrSignals W1a metrics (revertRate + medianHoursToFirstReview)", () => {
  it("aggregates analyzed-weighted revert rate and mean-of-medians first-review latency", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 10, revertRate: 10, medianHoursToFirstReview: 2 }),
        prStats({ analyzed: 30, revertRate: 2, medianHoursToFirstReview: 6 }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    expect(res!.avgRevertRate).toBe(4); // (10·10 + 2·30)/40 = 4 — weighted, not mean(10,2)=6
    expect(res!.typicalHoursToFirstReview).toBe(4); // mean(2,6) — median-of-medians, unweighted
  });

  it("an old blob lacking the fields contributes nothing — never a fabricated 0", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        legacyPrStats({ analyzed: 90 }), // huge but pre-field → zero weight for the new metrics
        prStats({ analyzed: 10, revertRate: 8, medianHoursToFirstReview: 5 }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    // A 0-treated legacy blob would drag this to (0·90 + 8·10)/100 = 1.
    expect(res!.avgRevertRate).toBe(8);
    expect(res!.typicalHoursToFirstReview).toBe(5);
    // The legacy repo still counts for the fields it DOES carry.
    expect(res!.repos).toBe(2);
  });

  it("an all-legacy fleet reads null (no sample), not 0 — and garbage never leaks NaN", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        legacyPrStats(),
        JSON.stringify({ ...(JSON.parse(prStats()) as object), revertRate: "oops", medianHoursToFirstReview: {} }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    expect(res!.avgRevertRate).toBeNull();
    expect(res!.typicalHoursToFirstReview).toBeNull();
  });

  it("perRepo rows carry the new fields — null for a legacy blob, measured values otherwise", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [prStats({ revertRate: 3, medianHoursToFirstReview: 7 }), legacyPrStats()], {
        extra: (i) => ({ fullName: `acme/repo-${i}`, name: `repo-${i}` }),
      }),
    );

    const res = await getOrgPrSignals("acme");
    const byName = new Map(res!.perRepo.map((r) => [r.name, r]));

    expect(byName.get("repo-0")).toMatchObject({ revertRate: 3, medianHoursToFirstReview: 7 });
    expect(byName.get("repo-1")).toMatchObject({ revertRate: null, medianHoursToFirstReview: null });
  });

  it("a measured 0 revert rate is data (averaged in), distinct from the legacy null", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 10, revertRate: 0 }),
        prStats({ analyzed: 10, revertRate: 10 }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    expect(res!.avgRevertRate).toBe(5); // mean(0,10) weighted — the 0 counts
  });
});

// ── getOrgPrSignals: W2 trailer attribution + AI pre-review ───────────────────
//
// aiTrailerRate / aiPreReviewedRate follow the exact W1a discipline: analyzed-weighted fleet rate,
// and a blob written before W2 (or a below-floor sample persisted as null) contributes NOTHING —
// null, never a fabricated 0 or NaN.

/** A blob as a pre-W2 scan persisted it: the trailer/pre-review keys don't exist. */
function preW2PrStats(over: Partial<PrStats> = {}): string {
  const o = JSON.parse(prStats(over)) as Record<string, unknown>;
  delete o.aiTrailerRate;
  delete o.aiPreReviewedRate;
  return JSON.stringify(o);
}

describe("getOrgPrSignals W2 metrics (aiTrailerRate + aiPreReviewedRate)", () => {
  it("aggregates analyzed-weighted trailer and pre-review rates", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 10, aiTrailerRate: 40, aiPreReviewedRate: 20 }),
        prStats({ analyzed: 30, aiTrailerRate: 8, aiPreReviewedRate: 0 }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    expect(res!.avgAiTrailerRate).toBe(16); // (40·10 + 8·30)/40 — weighted, not mean(40,8)=24
    expect(res!.avgAiPreReviewedRate).toBe(5); // (20·10 + 0·30)/40 — the measured 0 IS data
  });

  it("a pre-W2 blob contributes nothing — never a fabricated 0", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        preW2PrStats({ analyzed: 90 }), // huge but pre-field → zero weight for the new metrics
        prStats({ analyzed: 10, aiTrailerRate: 30, aiPreReviewedRate: 10 }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    expect(res!.avgAiTrailerRate).toBe(30); // a 0-treated legacy blob would drag this to 3
    expect(res!.avgAiPreReviewedRate).toBe(10);
    expect(res!.repos).toBe(2);
  });

  it("an all-legacy fleet reads null (no sample) — and garbage never leaks NaN", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        preW2PrStats(),
        JSON.stringify({ ...(JSON.parse(prStats()) as object), aiTrailerRate: "oops", aiPreReviewedRate: {} }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    expect(res!.avgAiTrailerRate).toBeNull();
    expect(res!.avgAiPreReviewedRate).toBeNull();
  });

  it("perRepo rows carry the new fields — null for a legacy blob or a below-floor sample", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma(
        "prStats",
        [prStats({ aiTrailerRate: 25, aiPreReviewedRate: 12 }), preW2PrStats(), prStats({ aiTrailerRate: null, aiPreReviewedRate: null })],
        { extra: (i) => ({ fullName: `acme/repo-${i}`, name: `repo-${i}` }) },
      ),
    );

    const res = await getOrgPrSignals("acme");
    const byName = new Map(res!.perRepo.map((r) => [r.name, r]));

    expect(byName.get("repo-0")).toMatchObject({ aiTrailerRate: 25, aiPreReviewedRate: 12 });
    expect(byName.get("repo-1")).toMatchObject({ aiTrailerRate: null, aiPreReviewedRate: null });
    expect(byName.get("repo-2")).toMatchObject({ aiTrailerRate: null, aiPreReviewedRate: null }); // persisted null = below floor
  });
});

// ── getOrgGovernance ──────────────────────────────────────────────────────────

const govExtra = (i: number) => ({ fullName: `acme/repo-${i}`, name: `repo-${i}` });

describe("getOrgGovernance blob resilience", () => {
  it("a well-formed set aggregates protected/review/checks/signed rates correctly", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma(
        "governance",
        [
          gov({ protected: true, requiresPullRequest: true, requiredApprovals: 1, requiresStatusChecks: true, requiresSignatures: true }),
          // PR required to merge, but ZERO required approvals — the author can self-merge unreviewed.
          // This must NOT count toward "require review" (the old requiresPullRequest predicate over-counted it).
          gov({ protected: true, requiresPullRequest: true, requiredApprovals: 0, requiresStatusChecks: false, requiresSignatures: false }),
          gov({ protected: false, requiresPullRequest: false, requiredApprovals: 0, requiresStatusChecks: false, requiresSignatures: false }),
          gov({ protected: true, requiresPullRequest: false, requiredApprovals: 0, requiresStatusChecks: true, requiresSignatures: false }),
        ],
        { extra: govExtra },
      ),
    );

    const res = await getOrgGovernance("acme");

    expect(res).not.toBeNull();
    expect(res!.repos).toBe(4);
    expect(res!.protectedRate).toBe(75); // 3/4
    expect(res!.requireReviewRate).toBe(25); // 1/4 — only the repo requiring ≥1 approval (NOT the PR-required-but-0-approvals one)
    expect(res!.requireChecksRate).toBe(50); // 2/4
    expect(res!.signedRate).toBe(25); // 1/4
    // Risk-first sort: the unprotected repo is surfaced first.
    expect(res!.perRepo[0].protected).toBe(false);
  });

  it("malformed blobs AND readable:false repos are excluded from the denominator", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma(
        "governance",
        [
          gov({ protected: true }),
          gov({ protected: false, readable: false }), // dropped by `!readable`
          "}{ corrupt",                                 // dropped by catch
          null,                                          // no blob
          gov({ protected: true }),
        ],
        { extra: govExtra },
      ),
    );

    const res = await getOrgGovernance("acme");

    // Denominator = 2 readable+valid repos. The unreadable repo must NOT count toward protectedRate.
    expect(res!.repos).toBe(2);
    expect(res!.protectedRate).toBe(100); // 2/2, not 2/3 (66) — unreadable excluded entirely
  });

  it("all-invalid / all-unreadable / empty input returns null", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("governance", [gov({ readable: false }), "bad", null], { extra: govExtra }),
    );
    await expect(getOrgGovernance("acme")).resolves.toBeNull();

    mockGetPrisma.mockReturnValue(fakePrisma("governance", [], { extra: govExtra }));
    await expect(getOrgGovernance("acme")).resolves.toBeNull();
  });
});

// ── getOrgActivity (calendar-week alignment) ───────────────────────────────────

describe("getOrgActivity blob resilience and calendar-week alignment", () => {
  it("sums same-cadence (same-week-scanned) mixed-length series RIGHT-aligned (most-recent week aligns, not week 0)", async () => {
    // Both repos scanned in the same week (fakePrisma default) → the last element of each is the SAME
    // calendar week, so this reduces to the legacy right-aligned sum.
    mockGetPrisma.mockReturnValue(
      fakePrisma("commitActivity", [
        JSON.stringify([1, 2, 3, 4]), // 4-week repo
        JSON.stringify([10, 20]),     // 2-week repo: aligns at the most-recent weeks
      ]),
    );

    const res = await getOrgActivity("acme");

    expect(res).not.toBeNull();
    expect(res!.weeks).toBe(4);
    // [1, 2, 3+10, 4+20] — the short series lands on weeks 2&3 (newest), not 0&1.
    expect(res!.series).toEqual([1, 2, 13, 24]);
    expect(res!.total).toBe(40);
    expect(res!.repos).toBe(2);
    // Axis labels: the span between oldest and latest week is exactly series.length - 1 weeks (the old
    // "{length} weeks ago" was off by one), and both are real YYYY-MM-DD week-start dates.
    const WK = 7 * 86_400_000;
    expect((Date.parse(res!.latestWeekIso) - Date.parse(res!.oldestWeekIso)) / WK).toBe(res!.series.length - 1);
    expect(res!.latestWeekIso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("aligns DIFFERENT-cadence repos by absolute calendar week, not array index (regression: fleet-rollups-insights #1)", async () => {
    // Repo A scanned this week, repo B scanned 2 weeks earlier. Each series' LAST element is its own
    // scan week. The old index-aligned sum would have stacked B's stale "last week" onto A's current
    // week; calendar-week alignment keeps them in their true weeks.
    const thisWeek = new Date("2026-06-17T00:00:00Z");   // week W
    const twoWeeksAgo = new Date("2026-06-03T00:00:00Z"); // week W-2
    mockGetPrisma.mockReturnValue(
      fakePrisma(
        "commitActivity",
        [
          JSON.stringify([5, 6, 7]),  // repo A (scanned W): weeks W-2, W-1, W
          JSON.stringify([100, 200]), // repo B (scanned W-2): weeks W-3, W-2
        ],
        { scannedAt: (i) => (i === 0 ? thisWeek : twoWeeksAgo) },
      ),
    );

    const res = await getOrgActivity("acme");

    expect(res).not.toBeNull();
    // Grid spans W-3..W: B's [100,200] land on W-3,W-2; A's [5,6,7] land on W-2,W-1,W.
    // W-3:100, W-2:200+5=205, W-1:6, W:7
    expect(res!.series).toEqual([100, 205, 6, 7]);
    expect(res!.weeks).toBe(4);
    expect(res!.total).toBe(318);
    expect(res!.repos).toBe(2);
  });

  it("malformed / non-array / empty-array / null series are skipped without corrupting the sum", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("commitActivity", [
        JSON.stringify([1, 2, 3]),
        "[1, 2, ",          // malformed JSON
        JSON.stringify({}), // valid JSON but not an array (Array.isArray guard)
        JSON.stringify([]), // empty array (length guard)
        null,                // no blob
        JSON.stringify([4, 5, 6]),
      ]),
    );

    const res = await getOrgActivity("acme");

    expect(res!.repos).toBe(2); // only the two good arrays
    expect(res!.series).toEqual([5, 7, 9]); // [1+4, 2+5, 3+6]
    expect(res!.total).toBe(21);
    expect(res!.series.every((n) => Number.isFinite(n))).toBe(true);
  });

  it("all-invalid / empty input returns null (not a throw, not an empty series)", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("commitActivity", ["nope", JSON.stringify({}), JSON.stringify([]), null]),
    );
    await expect(getOrgActivity("acme")).resolves.toBeNull();

    mockGetPrisma.mockReturnValue(fakePrisma("commitActivity", []));
    await expect(getOrgActivity("acme")).resolves.toBeNull();
  });

  it("endWeekStartMs is the Sunday 00:00 UTC starting the NEWEST bucket (weekIndex round-trip)", async () => {
    // Default scannedAt is Wed 2026-06-17 → its Sunday-aligned week starts Sun 2026-06-14.
    mockGetPrisma.mockReturnValue(fakePrisma("commitActivity", [JSON.stringify([1, 2, 3])]));

    const res = await getOrgActivity("acme");

    expect(res!.endWeekStartMs).toBe(Date.UTC(2026, 5, 14));
    // Anchor stays on the LATEST scan's week when cadences differ (series[last] = that week).
    const thisWeek = new Date("2026-06-17T00:00:00Z");
    const twoWeeksAgo = new Date("2026-06-03T00:00:00Z");
    mockGetPrisma.mockReturnValue(
      fakePrisma("commitActivity", [JSON.stringify([5, 6, 7]), JSON.stringify([100, 200])], {
        scannedAt: (i) => (i === 0 ? thisWeek : twoWeeksAgo),
      }),
    );
    const mixed = await getOrgActivity("acme");
    expect(mixed!.endWeekStartMs).toBe(Date.UTC(2026, 5, 14));
    // Oldest bucket = endWeekStartMs - (weeks-1) * 7d, matching the zero-filled grid the chart draws.
    expect(mixed!.weeks).toBe(4);
  });

  it("drops a stale repo whose latest scan predates the trailing horizon (regression: fleet-rollups-insights #4)", async () => {
    // Fresh repo scanned this week; stale repo last scanned ~a year ago. The stale repo's weeks sit far
    // older than the 26-week horizon anchored at the newest scan week, so it neither stretches the grid
    // nor counts — the sparkline stays a bounded RECENT window instead of ~52 weeks that are ~90% zeros
    // with a lone stale spike.
    const thisWeek = new Date("2026-06-17T00:00:00Z");
    const aYearAgo = new Date("2025-06-17T00:00:00Z"); // ~52 weeks earlier
    mockGetPrisma.mockReturnValue(
      fakePrisma(
        "commitActivity",
        [
          JSON.stringify([1, 2, 3]),  // fresh repo (scanned this week)
          JSON.stringify([100, 200]), // stale repo (scanned ~52 weeks ago) — dropped by the horizon
        ],
        { scannedAt: (i) => (i === 0 ? thisWeek : aYearAgo) },
      ),
    );

    const res = await getOrgActivity("acme");

    expect(res).not.toBeNull();
    expect(res!.repos).toBe(1); // the stale repo contributed nothing → not counted
    expect(res!.series).toEqual([1, 2, 3]);
    expect(res!.total).toBe(6);
    expect(res!.weeks).toBe(3); // bounded to the fresh repo's recent weeks, NOT stretched to ~53
  });
});

// ── shared guards ─────────────────────────────────────────────────────────────

describe("DB-not-configured and missing-org short-circuits", () => {
  it("all three return null when the DB is not configured (no prisma access)", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    await expect(getOrgPrSignals("acme")).resolves.toBeNull();
    await expect(getOrgGovernance("acme")).resolves.toBeNull();
    await expect(getOrgActivity("acme")).resolves.toBeNull();
    expect(mockGetPrisma).not.toHaveBeenCalled();
  });

  it("all three return null when the org is not found", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma("prStats", [prStats()], { org: false }));
    await expect(getOrgPrSignals("acme")).resolves.toBeNull();

    mockGetPrisma.mockReturnValue(fakePrisma("governance", [gov()], { org: false, extra: govExtra }));
    await expect(getOrgGovernance("acme")).resolves.toBeNull();

    mockGetPrisma.mockReturnValue(fakePrisma("commitActivity", [JSON.stringify([1])], { org: false }));
    await expect(getOrgActivity("acme")).resolves.toBeNull();
  });
});

// ── getOrgActivity: the week grid resolves in the CANONICAL ORG ZONE ───────────────────────────────
//
// The dashboard window snaps its boundaries in the org's canonical zone (src/lib/window.ts). The trend
// grid used to bin in UTC with `getUTCDay()`, which was right only while the canonical zone happened to
// default to UTC — set an org's zone and the trend chart and the tile deltas above it would be computed
// over different periods, disagreeing by up to a day's activity at each end.
//
// These tests drive an EXPLICIT non-UTC zone in both directions from Greenwich, so a future change to
// the default zone cannot silently restore the bug: whatever the zone, the grid must stay phase-locked
// to the provider's Sunday weeks (GitHub's commit_activity buckets are genuinely Sunday-UTC-aligned —
// converting the grid without converting through the source bucket is an off-by-one week on every bar).
describe("getOrgActivity — canonical-zone week grid", () => {
  const SERIES = JSON.stringify([1, 2, 3]);
  // A scan at Sun 2026-06-14 02:00 UTC: the WORST case for the boundary. In New York it is still
  // Saturday the 13th (the previous local week); in Tokyo it is already Sunday afternoon. A naive
  // "floor the scan instant in the org zone" fix moves the whole series a week west of Greenwich.
  const BOUNDARY_SCAN = new Date("2026-06-14T02:00:00Z");

  it.each(["UTC", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati"])(
    "bins the provider's Sunday week identically in %s — the grid cannot drift off the window's weeks",
    async (tz) => {
      mockGetPrisma.mockReturnValue(
        fakePrisma("commitActivity", [SERIES], { scannedAt: () => BOUNDARY_SCAN, timezone: tz }),
      );

      const res = await getOrgActivity("acme");

      // The provider bucket containing the scan starts Sun 2026-06-14, and that is the week the newest
      // bar belongs to in every zone — the bucket overlaps that zoned week on six of its seven days.
      expect(res!.endWeekStartMs).toBe(Date.UTC(2026, 5, 14));
      expect(res!.latestWeekIso).toBe("2026-06-14");
      expect(res!.oldestWeekIso).toBe("2026-05-31"); // three buckets back, contiguous
      expect(res!.series).toEqual([1, 2, 3]);
    },
  );

  it("keeps different-cadence repos in phase under a shifted zone (no half-week drift between them)", async () => {
    // Repo A scanned Wed 2026-06-17, repo B two provider weeks earlier — but B's scan sits on the far
    // side of a local midnight from A's. If the two were floored in different frames their series would
    // sum one bucket apart, which is the phase bug the Sunday floor exists to prevent.
    mockGetPrisma.mockReturnValue(
      fakePrisma(
        "commitActivity",
        [JSON.stringify([5, 6, 7]), JSON.stringify([100, 200])],
        {
          scannedAt: (i) => (i === 0 ? new Date("2026-06-17T00:00:00Z") : new Date("2026-06-03T23:30:00Z")),
          timezone: "America/New_York",
        },
      ),
    );

    const res = await getOrgActivity("acme");

    // Identical to the UTC expectation of the same fixture: W-3:100, W-2:200+5, W-1:6, W:7.
    expect(res!.series).toEqual([100, 205, 6, 7]);
    expect(res!.endWeekStartMs).toBe(Date.UTC(2026, 5, 14));
  });

  it("a DST-transition week is still exactly one bucket wide (calendar weeks, not 168h of ms)", async () => {
    // US DST began Sun 2026-03-08. A 167-hour local week must not fold two provider buckets into one
    // (or leave a phantom empty one): consecutive buckets stay consecutive indices, so a 4-element
    // series spanning the transition emits exactly 4 weeks, 7 calendar days apart.
    mockGetPrisma.mockReturnValue(
      fakePrisma("commitActivity", [JSON.stringify([1, 2, 3, 4])], {
        scannedAt: () => new Date("2026-03-18T12:00:00Z"),
        timezone: "America/New_York",
      }),
    );

    const res = await getOrgActivity("acme");

    expect(res!.weeks).toBe(4);
    expect(res!.latestWeekIso).toBe("2026-03-15");
    expect(res!.oldestWeekIso).toBe("2026-02-22");
    const WK = 7 * 86_400_000;
    expect((Date.parse(res!.latestWeekIso) - Date.parse(res!.oldestWeekIso)) / WK).toBe(3);
  });
});

// ── getOrgPrSignals: each fleet rate carries the basis that produced it ───────
//
// `repos` and `totalPrs` describe the FLEET, and are the denominator of none of the eight `avg*Rate`
// percentages beside them: `weightedRate` skips every repo whose rate is null, and even a
// contributing repo's `analyzed` is the whole scanned window rather than the rate's own denominator
// (reviewedRate is over human-authored MERGED PRs). `rateBasis` states, per rate, the weight and the
// repo count actually behind it plus the rate's own summed denominator — the number a reader may
// legitimately divide by. The arithmetic of the percentages themselves is unchanged.

describe("getOrgPrSignals rateBasis (each rate's own weight, repos and denominator)", () => {
  it("reports the weight and repo count behind a rate only some repos measured", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 10, reviewedRate: 80 }),
        prStats({ analyzed: 100, reviewedRate: null }), // huge, but no sample → no weight
      ]),
    );

    const res = await getOrgPrSignals("acme");

    expect(res!.repos).toBe(2);
    expect(res!.totalPrs).toBe(110);
    expect(res!.avgReviewedRate).toBe(80);
    // The fleet coverage figure rests on ONE repo and 10 PRs, not on the "2 repos / 110 PRs" beside it.
    expect(res!.rateBasis.reviewed).toMatchObject({ weight: 10, repos: 1 });
    // An analyzed-denominated rate every repo measured does span the whole fleet.
    expect(res!.rateBasis.smallPr).toMatchObject({ weight: 110, repos: 2, population: 110 });
  });

  it("sums a sub-denominated rate's OWN population from the persisted rate book", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 40, reviewedRate: 80, rates: { reviewed: qualifiedRate("reviewed", 18, 22) } }),
        prStats({ analyzed: 20, reviewedRate: 50, rates: { reviewed: qualifiedRate("reviewed", 5, 10) } }),
      ]),
    );

    const res = await getOrgPrSignals("acme");

    // 32 human-merged PRs — NOT the 60 analyzed PRs the fleet volume would suggest.
    expect(res!.rateBasis.reviewed).toMatchObject({ weight: 60, repos: 2, population: 32 });
  });

  it("leaves the population null when a contributing repo never persisted one (pre-contract blob)", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma("prStats", [
        prStats({ analyzed: 40, reviewedRate: 80, rates: { reviewed: qualifiedRate("reviewed", 18, 22) } }),
        prStats({ analyzed: 20, reviewedRate: 50 }), // pre-contract: no rate book at all
      ]),
    );

    const res = await getOrgPrSignals("acme");

    // A partial sum (22) would be a smaller denominator masquerading as a complete one.
    expect(res!.rateBasis.reviewed.population).toBeNull();
    expect(res!.rateBasis.reviewed.repos).toBe(2);
  });

  it("denominates the merge rate on DECIDED PRs, not on the analyzed window", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma("prStats", [prStats({ analyzed: 12, open: 2, merged: 8, closedUnmerged: 2 })]));

    const res = await getOrgPrSignals("acme");

    expect(res!.rateBasis.merge).toMatchObject({ weight: 12, repos: 1, population: 10 }); // the 2 open PRs are not in it
    expect(res!.totalPrs).toBe(12);
  });

  it("a rate NO repo measured reports zero weight, zero repos and a null population", async () => {
    mockGetPrisma.mockReturnValue(fakePrisma("prStats", [preW2PrStats({ analyzed: 10 })]));

    const res = await getOrgPrSignals("acme");

    expect(res!.avgAiTrailerRate).toBeNull();
    expect(res!.rateBasis.aiTrailer).toEqual({ weight: 0, repos: 0, population: null });
  });

  it("perRepo rows carry their own per-rate denominators", async () => {
    mockGetPrisma.mockReturnValue(
      fakePrisma(
        "prStats",
        [prStats({ analyzed: 12, open: 2, merged: 8, closedUnmerged: 2, rates: { aiGoverned: qualifiedRate("aiGoverned", 4, 6) } })],
        { extra: () => ({ fullName: "acme/api", name: "api" }) },
      ),
    );

    const res = await getOrgPrSignals("acme");

    expect(res!.perRepo[0]!.population).toMatchObject({ smallPr: 12, merge: 10, aiTrailer: 8, aiGoverned: 6 });
    // `reviewed` was never persisted by this blob, so the key is ABSENT — not `analyzed` standing in.
    expect(res!.perRepo[0]!.population.reviewed).toBeUndefined();
  });
});
