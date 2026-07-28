// The Delivery trend's pure core (G7-09): day bucketing, volume weighting, the null-vs-measured-zero
// discipline, blob resilience, the mock-engine flag, and — the one that matters most — that the slope
// read is gated by the SHARED forecast insufficiency floor rather than a floor of its own.
//
// These call `buildDeliveryTrend` / `buildDeliveryRateFit` directly with plain objects: both are pure,
// so nothing here needs Prisma, a clock, or a DB.

import { describe, it, expect } from "vitest";
import { buildDeliveryTrend, buildDeliveryRateFit, type DeliveryScanRow } from "./org-delivery-trend";
import { MIN_FORECAST_POINTS, MIN_FORECAST_SPAN_DAYS, forecastInsufficiency, forecastTrajectory } from "@/lib/maturity/forecast";
import type { PrStats } from "@/lib/types";

function prStats(over: Partial<PrStats> = {}): string {
  const base: PrStats = {
    analyzed: 10,
    totalCount: 100,
    open: 1,
    merged: 8,
    closedUnmerged: 1,
    mergeRate: 80,
    reviewedRate: 50,
    avgReviews: 1,
    avgComments: 2,
    medianHoursToMerge: 12,
    medianHoursToFirstReview: 3,
    avgLineChanges: 100,
    avgChangedFiles: 4,
    smallPrRate: 70,
    botAuthoredRate: 10,
    aiInvolvedRate: 30,
    aiGovernedRate: 60,
    revertRate: 2,
    draftRate: 5,
    tools: [],
  };
  return JSON.stringify({ ...base, ...over });
}

function gov(over: { readable?: boolean; protected?: boolean } = {}): string {
  return JSON.stringify({ readable: true, protected: true, ...over });
}

function scan(over: Partial<DeliveryScanRow> & { scannedAt: Date }): DeliveryScanRow {
  return {
    engineProvider: "claude",
    prStats: null,
    governance: null,
    repoId: "repo_1",
    ...over,
  };
}

// The canonical zone defaults to UTC, so day keys are UTC day keys. Pin that explicitly.
const TZ = "UTC";

describe("buildDeliveryTrend — day bucketing", () => {
  it("groups scans into canonical-zone calendar days, oldest first", () => {
    const points = buildDeliveryTrend(
      [
        scan({ scannedAt: new Date("2026-05-03T09:00:00Z"), prStats: prStats() }),
        scan({ scannedAt: new Date("2026-05-01T23:59:59Z"), prStats: prStats() }),
        scan({ scannedAt: new Date("2026-05-01T00:00:00Z"), prStats: prStats(), repoId: "repo_2" }),
      ],
      TZ,
    );
    expect(points.map((p) => p.date)).toEqual(["2026-05-01", "2026-05-03"]);
    // Both May-1 scans land in the SAME bucket (half-open day, no midnight split).
    expect(points[0]!.scans).toBe(2);
    expect(points[0]!.repos).toBe(2);
  });

  it("counts distinct repos, not scans, behind a day", () => {
    const points = buildDeliveryTrend(
      [
        scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: prStats(), repoId: "r1" }),
        scan({ scannedAt: new Date("2026-05-01T02:00:00Z"), prStats: prStats(), repoId: "r1" }),
      ],
      TZ,
    );
    expect(points[0]!.scans).toBe(2);
    expect(points[0]!.repos).toBe(1);
  });

  it("excludes a scan carrying NEITHER a usable PR blob nor readable governance from the sample size", () => {
    // A page that says "3 scans behind this point" must not be counting scans that said nothing.
    const points = buildDeliveryTrend(
      [
        scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: prStats() }),
        scan({ scannedAt: new Date("2026-05-01T02:00:00Z") }), // no blobs at all
        scan({ scannedAt: new Date("2026-05-01T03:00:00Z"), prStats: prStats({ analyzed: 0 }) }), // no PRs analyzed
        scan({ scannedAt: new Date("2026-05-01T04:00:00Z"), governance: gov({ readable: false }) }),
      ],
      TZ,
    );
    expect(points).toHaveLength(1);
    expect(points[0]!.scans).toBe(1);
  });
});

describe("buildDeliveryTrend — weighting and the null-vs-zero discipline", () => {
  it("weights rates by analyzed PR count, mirroring getOrgPrSignals (not an average of averages)", () => {
    // 90 PRs at 100% vs 10 PRs at 0% → 90%, not the 50% an unweighted mean would report.
    const points = buildDeliveryTrend(
      [
        scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: prStats({ analyzed: 90, reviewedRate: 100 }) }),
        scan({ scannedAt: new Date("2026-05-01T02:00:00Z"), prStats: prStats({ analyzed: 10, reviewedRate: 0 }), repoId: "r2" }),
      ],
      TZ,
    );
    expect(points[0]!.reviewedRate).toBe(90);
    expect(points[0]!.prs).toBe(100);
  });

  it("a null rate is 'no sample', never a measured 0 — and a day with no sample at all stays null", () => {
    const points = buildDeliveryTrend(
      [
        scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: prStats({ analyzed: 50, reviewedRate: null, aiGovernedRate: null }) }),
        scan({ scannedAt: new Date("2026-05-02T01:00:00Z"), prStats: prStats({ analyzed: 50, reviewedRate: 40, aiGovernedRate: null }) }),
      ],
      TZ,
    );
    expect(points[0]!.reviewedRate).toBeNull();
    expect(points[0]!.aiGovernedRate).toBeNull();
    // Day 2 has a sample for reviewedRate only.
    expect(points[1]!.reviewedRate).toBe(40);
    expect(points[1]!.aiGovernedRate).toBeNull();
  });

  it("a rate present on only SOME of a day's scans is weighted over just those scans", () => {
    const points = buildDeliveryTrend(
      [
        scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: prStats({ analyzed: 10, reviewedRate: 80 }) }),
        scan({ scannedAt: new Date("2026-05-01T02:00:00Z"), prStats: prStats({ analyzed: 990, reviewedRate: null }), repoId: "r2" }),
      ],
      TZ,
    );
    // The 990-PR repo has no reviewed sample; it must not dilute the one that does toward 0.
    expect(points[0]!.reviewedRate).toBe(80);
  });

  it("governance: unreadable rules contribute nothing — 'couldn't read' is not 'unprotected'", () => {
    const points = buildDeliveryTrend(
      [
        scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), governance: gov({ protected: true }) }),
        scan({ scannedAt: new Date("2026-05-01T02:00:00Z"), governance: gov({ readable: false, protected: false }), repoId: "r2" }),
        scan({ scannedAt: new Date("2026-05-02T01:00:00Z"), governance: gov({ readable: false }) }),
      ],
      TZ,
    );
    expect(points[0]!.protectedRate).toBe(100); // 1 of 1 readable, not 1 of 2
    // A day whose only scan was unreadable produces no point at all (nothing was measured).
    expect(points).toHaveLength(1);
  });

  it("hours-to-merge is a mean of per-scan medians, and null when nothing reported one", () => {
    const points = buildDeliveryTrend(
      [
        scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: prStats({ medianHoursToMerge: 10 }) }),
        scan({ scannedAt: new Date("2026-05-01T02:00:00Z"), prStats: prStats({ medianHoursToMerge: 15 }), repoId: "r2" }),
        scan({ scannedAt: new Date("2026-05-02T02:00:00Z"), prStats: prStats({ medianHoursToMerge: null }) }),
      ],
      TZ,
    );
    expect(points[0]!.hoursToMerge).toBe(12.5);
    expect(points[1]!.hoursToMerge).toBeNull();
  });
});

describe("buildDeliveryTrend — resilience and engine honesty", () => {
  it("a malformed / non-JSON blob is skipped, never thrown and never counted", () => {
    expect(() =>
      buildDeliveryTrend([scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: "{not json", governance: "<html>" })], TZ),
    ).not.toThrow();
    expect(buildDeliveryTrend([scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: "{not json" })], TZ)).toEqual([]);
  });

  it("a garbage rate field never leaks NaN into a weighted mean", () => {
    const points = buildDeliveryTrend(
      [
        scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: JSON.stringify({ analyzed: 10, reviewedRate: "oops", tools: [] }) }),
        scan({ scannedAt: new Date("2026-05-01T02:00:00Z"), prStats: prStats({ analyzed: 10, reviewedRate: 60 }), repoId: "r2" }),
      ],
      TZ,
    );
    expect(points[0]!.reviewedRate).toBe(60);
    expect(Number.isFinite(points[0]!.reviewedRate!)).toBe(true);
  });

  it("flags a day as mock ONLY when every scan behind it came from the mock engine", () => {
    const day = (engine: string, at: string, repoId: string) => scan({ scannedAt: new Date(at), engineProvider: engine, prStats: prStats(), repoId });
    const points = buildDeliveryTrend(
      [
        day("mock", "2026-05-01T01:00:00Z", "r1"),
        day("mock", "2026-05-01T02:00:00Z", "r2"),
        day("mock", "2026-05-02T01:00:00Z", "r1"),
        day("claude", "2026-05-02T02:00:00Z", "r2"),
      ],
      TZ,
    );
    expect(points[0]!.mock).toBe(true);
    expect(points[1]!.mock).toBe(false);
  });

  it("an invalid scannedAt is skipped rather than producing an 'Invalid Date' bucket", () => {
    const points = buildDeliveryTrend(
      [scan({ scannedAt: new Date("nope"), prStats: prStats() }), scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: prStats() })],
      TZ,
    );
    expect(points.map((p) => p.date)).toEqual(["2026-05-01"]);
  });
});

// ── THE PROJECTION GATE ──────────────────────────────────────────────────────
// The delivery slope must not invent its own idea of "enough history". It has to be the SAME floor
// (`forecastInsufficiency` — MIN_FORECAST_POINTS distinct days AND MIN_FORECAST_SPAN_DAYS of calendar
// span) that the trends page and the org rollup use, so "we don't project from a 5-day sample" means
// one thing product-wide.

function dayPoints(spec: { date: string; reviewedRate: number | null }[]) {
  return buildDeliveryTrend(
    spec.map((s, i) =>
      scan({
        scannedAt: new Date(`${s.date}T12:00:00Z`),
        repoId: `r${i}`,
        prStats: prStats({ analyzed: 10, reviewedRate: s.reviewedRate }),
      }),
    ),
    TZ,
  );
}

describe("buildDeliveryRateFit — gated by the SHARED forecast insufficiency floor", () => {
  it("refuses to project below the distinct-day floor, with the shared copy", () => {
    const points = dayPoints([
      { date: "2026-05-01", reviewedRate: 40 },
      { date: "2026-06-01", reviewedRate: 80 },
    ]);
    const fit = buildDeliveryRateFit(points, "reviewedRate");
    expect(fit.points).toBeLessThan(MIN_FORECAST_POINTS);
    expect(fit.insufficiency).toContain("distinct scan days");
  });

  it("refuses to project below the calendar-SPAN floor even with enough points", () => {
    const points = dayPoints([
      { date: "2026-05-01", reviewedRate: 40 },
      { date: "2026-05-02", reviewedRate: 55 },
      { date: "2026-05-03", reviewedRate: 70 },
      { date: "2026-05-04", reviewedRate: 85 },
    ]);
    const fit = buildDeliveryRateFit(points, "reviewedRate");
    expect(fit.points).toBeGreaterThanOrEqual(MIN_FORECAST_POINTS);
    expect(fit.spanDays).toBeLessThan(MIN_FORECAST_SPAN_DAYS);
    expect(fit.insufficiency).toContain(`at least ${MIN_FORECAST_SPAN_DAYS}`);
  });

  it("is EXACTLY the shared gate — the same verdict forecastInsufficiency gives the same series", () => {
    const points = dayPoints([
      { date: "2026-05-01", reviewedRate: 40 },
      { date: "2026-05-15", reviewedRate: 50 },
      { date: "2026-05-29", reviewedRate: 60 },
      { date: "2026-06-12", reviewedRate: 70 },
    ]);
    const fit = buildDeliveryRateFit(points, "reviewedRate");
    const shared = forecastInsufficiency(
      forecastTrajectory(points.map((p) => ({ date: p.date, value: p.reviewedRate! }))),
    );
    expect(fit.insufficiency).toBe(shared);
    expect(fit.insufficiency).toBeNull();
    expect(fit.trajectory).toBe("rising");
    expect(fit.perWeek).toBeGreaterThan(0);
  });

  it("drops unmeasured days instead of zero-filling them — a gap must not fabricate a collapse", () => {
    // Zero-filling the null day would turn a flat 60% series into a violent dip and recovery, and flip
    // the slope. The fit must simply not see that day.
    const points = dayPoints([
      { date: "2026-05-01", reviewedRate: 60 },
      { date: "2026-05-15", reviewedRate: null },
      { date: "2026-05-29", reviewedRate: 60 },
      { date: "2026-06-12", reviewedRate: 60 },
    ]);
    const fit = buildDeliveryRateFit(points, "reviewedRate");
    expect(fit.points).toBe(3); // the null day contributed nothing
    expect(fit.perWeek).toBe(0);
    expect(fit.trajectory).toBe("flat");
  });

  it("an empty series is insufficient, not a confident flat zero", () => {
    const fit = buildDeliveryRateFit([], "reviewedRate");
    expect(fit.insufficiency).toContain("Not enough history");
    expect(fit.perWeek).toBe(0);
  });
});
