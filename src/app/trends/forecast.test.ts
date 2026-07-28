// The forecast-vs-range-toggle contract (G5-01 display side / G4-16 data side — one defect).
//
// Pinned here:
//   1. STABILITY — the trends forecast is IDENTICAL whichever range the viewer has selected, because
//      it is fit over the full history and the range slice never reaches it.
//   2. THE BUG IT REPLACES — fitting the same history per displayed range genuinely produces
//      different, contradictory answers (so #1 is a real property, not a vacuous one).
//   3. REFUSAL — a sample too thin to project (few distinct days, or a short calendar span, however
//      many scans it contains) yields an explicit insufficiency message, not a confident ETA.

import { describe, it, expect, vi, afterEach } from "vitest";
import { fitTrendForecast } from "@/app/trends/forecast";
import { withinRange, RANGES } from "@/components/report/DimensionTrendsRange";
import {
  forecastInsufficiency,
  forecastTrajectory,
  isProjectable,
  MIN_FORECAST_SPAN_DAYS,
} from "@/lib/maturity/forecast";
import type { HistoryPoint } from "@/lib/db/scans";

const DAY = 86_400_000;
const NOW = Date.parse("2026-06-19T12:00:00.000Z");

function pt(daysAgo: number, overallScore: number): HistoryPoint {
  return {
    id: `s${daysAgo}`,
    headSha: null,
    overallScore,
    level: "L3",
    levelName: "Integrating",
    confidence: 0.9,
    engineProvider: "test",
    engineModel: "test",
    scannedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    dimensions: [],
  };
}

/** 90 days of steady climb (newest-first), with the last five days dipping hard — the exact shape
 *  that made a 5d slice contradict the "on track" banner sitting above it. */
function climbThenDip(): HistoryPoint[] {
  const scans: HistoryPoint[] = [];
  for (let d = 90; d > 5; d -= 5) scans.push(pt(d, 90 - d)); // 0 → 85 over 85 days
  for (let d = 5; d >= 0; d--) scans.push(pt(d, 85 - (5 - d) * 4)); // sharp recent fall
  return scans.sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt));
}

describe("fitTrendForecast — range independence", () => {
  afterEach(() => vi.useRealTimers());
  const pinNow = () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW); // withinRange reads the clock
  };

  it("returns the SAME forecast for every range the toggle can select", () => {
    pinNow();
    const scans = climbThenDip();
    const baseline = fitTrendForecast(scans, NOW);
    expect(baseline).not.toBeNull();
    const visibleCounts = new Set<number>();
    for (const r of RANGES) {
      // Simulate the page under each toggle position: the CHART's series narrows, the forecast's
      // input does not (there is no range argument to pass).
      visibleCounts.add(withinRange(scans, r.days).length);
      expect(fitTrendForecast(scans, NOW)).toEqual(baseline);
    }
    expect(visibleCounts.size).toBeGreaterThan(1); // the chart really did change under the toggle
  });

  it("SANITY: fitting per displayed range would genuinely contradict itself (the bug being fixed)", () => {
    pinNow();
    const scans = climbThenDip();
    const perRange = RANGES.map((r) => {
      const sliced = withinRange(scans, r.days).map((s) => ({ date: s.scannedAt, value: s.overallScore }));
      return forecastTrajectory(sliced, 90, NOW)?.trajectory ?? null;
    });
    // The short window reads "falling" while the full history reads "rising" — the same repo, two
    // opposite headlines, decided by a zoom control. This is what the fix removes.
    expect(perRange).toContain("falling");
    expect(fitTrendForecast(scans, NOW)!.trajectory).toBe("rising");
  });
});

describe("forecastInsufficiency — refusing to project from too little", () => {
  it("refuses a dense but SHORT sample (many scans, days of span)", () => {
    // Five scans over four days — plenty of points, no span. Exactly the "confident-looking
    // projection from noise" case.
    const scans = [pt(0, 61), pt(1, 55), pt(2, 60), pt(3, 52), pt(4, 58)];
    const f = fitTrendForecast(scans, NOW);
    expect(f).not.toBeNull();
    expect(f!.points).toBeGreaterThanOrEqual(3); // the n-based guard alone would have passed it
    expect(isProjectable(f)).toBe(false);
    expect(forecastInsufficiency(f)).toContain(`at least ${MIN_FORECAST_SPAN_DAYS}`);
  });

  it("refuses a two-point fit (R² is 1 by construction, not by trend)", () => {
    const f = fitTrendForecast([pt(0, 70), pt(40, 50)], NOW);
    expect(f!.fitQuality).toBe(1);
    expect(isProjectable(f)).toBe(false);
    expect(forecastInsufficiency(f)).toContain("distinct scan days");
  });

  it("refuses when there is no fit at all (a single scan)", () => {
    expect(fitTrendForecast([pt(0, 70)], NOW)).toBeNull();
    expect(forecastInsufficiency(null)).toContain("Not enough history");
  });

  it("accepts a fit with enough distinct days AND enough calendar span", () => {
    const f = fitTrendForecast(climbThenDip(), NOW);
    expect(isProjectable(f)).toBe(true);
    expect(forecastInsufficiency(f)).toBeNull();
  });
});
