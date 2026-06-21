// Resilience of the JSON-blob signal aggregators (getOrgPrSignals / getOrgGovernance / getOrgActivity).
// Each JSON.parse's per-repo blobs persisted by earlier scans and folds them into fleet headline
// rates under a bare `catch {}`. These tests pin that a malformed/non-JSON/null blob is SKIPPED
// (never throws, never corrupts the denominator), a partial blob contributes only its present fields
// with no NaN/undefined leak, a well-formed set aggregates to correct totals, and an all-bad/empty
// input returns the documented `null` — not a crash.

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PrStats } from "@/lib/types";

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
  opts: { org?: boolean; extra?: (i: number) => Record<string, unknown>; scannedAt?: (i: number) => Date } = {},
) {
  const orgRow = opts.org === false ? null : { id: "org_1", slug: "acme" };
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
    expect(res!.avgMergeRate).toBe(70); // mean(80,60)
    expect(res!.avgSmallPrRate).toBe(60); // mean(70,50)
    expect(res!.avgAiInvolvedRate).toBe(20); // mean(30,10)
    expect(res!.typicalHoursToMerge).toBe(15); // mean(10,20)
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
    expect(res!.avgMergeRate).toBe(70); // mean of the GOOD rows only, not skewed by NaN
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
