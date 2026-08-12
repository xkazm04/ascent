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

// ── W1a surfaced blob metrics: revertRate + smallPrRate + hoursToFirstReview ─────────────────
//
// These were persisted in every historical prStats blob but never read window-wide. The trend must
// BACK-FILL from those old rows day one — which hinges on the num() discipline: a blob written
// before a field existed yields null for that field (no weight), while its other fields still count.

/** A blob exactly as an old scan persisted it: the W1a keys are absent, everything else present. */
function legacyPrStats(over: Partial<PrStats> = {}): string {
  const o = JSON.parse(prStats(over)) as Record<string, unknown>;
  delete o.revertRate;
  delete o.smallPrRate;
  delete o.medianHoursToFirstReview;
  return JSON.stringify(o);
}

describe("buildDeliveryTrend — W1a metrics (revertRate / smallPrRate / hoursToFirstReview)", () => {
  it("back-fills from historical blobs: rates analyzed-weighted, latency a mean of medians", async () => {
    const points = buildDeliveryTrend(
      [
        scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: prStats({ analyzed: 30, revertRate: 10, smallPrRate: 90, medianHoursToFirstReview: 2 }) }),
        scan({ scannedAt: new Date("2026-05-01T02:00:00Z"), prStats: prStats({ analyzed: 10, revertRate: 2, smallPrRate: 50, medianHoursToFirstReview: 6 }), repoId: "r2" }),
      ],
      TZ,
    );
    expect(points[0]!.revertRate).toBe(8); // (10·30 + 2·10)/40
    expect(points[0]!.smallPrRate).toBe(80); // (90·30 + 50·10)/40
    expect(points[0]!.hoursToFirstReview).toBe(4); // mean(2,6), unweighted like hoursToMerge
  });

  it("a pre-field legacy blob contributes NOTHING to the new metrics but still feeds the old ones", () => {
    const points = buildDeliveryTrend(
      [scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: legacyPrStats({ analyzed: 20, mergeRate: 70 }) })],
      TZ,
    );
    // The old row still produces a point (back-fill!), with the new fields honestly null.
    expect(points).toHaveLength(1);
    expect(points[0]!.mergeRate).toBe(70);
    expect(points[0]!.revertRate).toBeNull();
    expect(points[0]!.smallPrRate).toBeNull();
    expect(points[0]!.hoursToFirstReview).toBeNull();
  });

  it("a legacy blob sharing a day with a modern one carries no weight in the new rates", () => {
    const points = buildDeliveryTrend(
      [
        scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: legacyPrStats({ analyzed: 990 }) }),
        scan({ scannedAt: new Date("2026-05-01T02:00:00Z"), prStats: prStats({ analyzed: 10, revertRate: 6, medianHoursToFirstReview: 3 }), repoId: "r2" }),
      ],
      TZ,
    );
    // Zero-weighting the legacy 990-PR blob keeps the measured 6% intact (0-filled it would be ~0%).
    expect(points[0]!.revertRate).toBe(6);
    expect(points[0]!.hoursToFirstReview).toBe(3);
  });
});

// ── W2 metrics: aiTrailerRate + aiPreReviewedRate ─────────────────────────────
//
// Same num() discipline as W1a: a blob written before W2 — or one persisting null for a below-floor
// merged sample — contributes no weight, so history back-fills honestly instead of fabricating 0s.

/** A blob exactly as a pre-W2 scan persisted it: the trailer/pre-review keys are absent. */
function preW2PrStats(over: Partial<PrStats> = {}): string {
  const o = JSON.parse(prStats(over)) as Record<string, unknown>;
  delete o.aiTrailerRate;
  delete o.aiPreReviewedRate;
  return JSON.stringify(o);
}

describe("buildDeliveryTrend — W2 metrics (aiTrailerRate / aiPreReviewedRate)", () => {
  it("weights both rates by analyzed PRs, like every sibling rate", () => {
    const points = buildDeliveryTrend(
      [
        scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: prStats({ analyzed: 30, aiTrailerRate: 20, aiPreReviewedRate: 10 }) }),
        scan({ scannedAt: new Date("2026-05-01T02:00:00Z"), prStats: prStats({ analyzed: 10, aiTrailerRate: 60, aiPreReviewedRate: 50 }), repoId: "r2" }),
      ],
      TZ,
    );
    expect(points[0]!.aiTrailerRate).toBe(30); // (20·30 + 60·10)/40
    expect(points[0]!.aiPreReviewedRate).toBe(20); // (10·30 + 50·10)/40
  });

  it("a pre-W2 legacy blob contributes NOTHING to the new metrics but still feeds the old ones", () => {
    const points = buildDeliveryTrend(
      [scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: preW2PrStats({ analyzed: 20, mergeRate: 70 }) })],
      TZ,
    );
    expect(points).toHaveLength(1);
    expect(points[0]!.mergeRate).toBe(70);
    expect(points[0]!.aiTrailerRate).toBeNull();
    expect(points[0]!.aiPreReviewedRate).toBeNull();
  });

  it("a persisted null (below the >=5 merged floor) carries no weight next to a measured scan", () => {
    const points = buildDeliveryTrend(
      [
        scan({ scannedAt: new Date("2026-05-01T01:00:00Z"), prStats: prStats({ analyzed: 990, aiTrailerRate: null, aiPreReviewedRate: null }) }),
        scan({ scannedAt: new Date("2026-05-01T02:00:00Z"), prStats: prStats({ analyzed: 10, aiTrailerRate: 40, aiPreReviewedRate: 20 }), repoId: "r2" }),
      ],
      TZ,
    );
    expect(points[0]!.aiTrailerRate).toBe(40); // zero-filling the 990-PR null would drag it to ~0
    expect(points[0]!.aiPreReviewedRate).toBe(20);
  });
});

describe("buildDeliveryRateFit — hoursToFirstReview (the review-time delta readout)", () => {
  it("is published in DELIVERY_FIT_METRICS", async () => {
    const { DELIVERY_FIT_METRICS } = await import("./org-delivery-trend");
    expect(DELIVERY_FIT_METRICS).toContain("hoursToFirstReview");
  });

  it("fits an OLS slope on review latency through the SAME shared insufficiency gate", () => {
    const points = buildDeliveryTrend(
      [
        ["2026-05-01", 10],
        ["2026-05-15", 14],
        ["2026-05-29", 18],
        ["2026-06-12", 22],
      ].map(([date, h], i) =>
        scan({ scannedAt: new Date(`${date}T12:00:00Z`), repoId: `r${i}`, prStats: prStats({ medianHoursToFirstReview: h as number }) }),
      ),
      TZ,
    );
    const fit = buildDeliveryRateFit(points, "hoursToFirstReview");
    expect(fit.insufficiency).toBeNull();
    expect(fit.trajectory).toBe("rising"); // review latency RISING — the Assist→Delegate bottleneck
    expect(fit.perWeek).toBeCloseTo(2, 0); // +4h per fortnight ≈ +2h/week, in HOURS not points
  });

  it("drops days where only legacy blobs ran instead of zero-filling them", () => {
    const rows = [
      scan({ scannedAt: new Date("2026-05-01T12:00:00Z"), repoId: "r1", prStats: prStats({ medianHoursToFirstReview: 10 }) }),
      scan({ scannedAt: new Date("2026-05-15T12:00:00Z"), repoId: "r2", prStats: legacyPrStats() }), // pre-field day
      scan({ scannedAt: new Date("2026-05-29T12:00:00Z"), repoId: "r3", prStats: prStats({ medianHoursToFirstReview: 10 }) }),
      scan({ scannedAt: new Date("2026-06-12T12:00:00Z"), repoId: "r4", prStats: prStats({ medianHoursToFirstReview: 10 }) }),
    ];
    const fit = buildDeliveryRateFit(buildDeliveryTrend(rows, TZ), "hoursToFirstReview");
    expect(fit.points).toBe(3); // the legacy day contributed nothing
    expect(fit.perWeek).toBe(0);
    expect(fit.trajectory).toBe("flat"); // a zero-filled legacy day would fabricate a dip
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
