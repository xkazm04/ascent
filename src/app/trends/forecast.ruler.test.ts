// The ruler rule on the forecast: a line fit across a rubric bump would read the bump as a slope. The
// fit uses only the trailing run of points scored under the latest point's rubric, walking back until
// the first provable change (`sameRuler === false`); a null rubric never breaks the run.

import { describe, it, expect } from "vitest";
import { fitTrendForecast, rubricTruncation } from "@/app/trends/forecast";
import type { HistoryPoint } from "@/lib/db/scans";

const DAY = 86_400_000;
const NOW = Date.parse("2026-06-19T12:00:00.000Z");

function pt(daysAgo: number, overallScore: number, rubricVersion: string | null): HistoryPoint {
  return {
    id: `s${daysAgo}`,
    headSha: null,
    overallScore,
    level: "L3",
    levelName: "Integrating",
    confidence: 0.9,
    engineProvider: "test",
    engineModel: "test",
    rubricVersion,
    scannedAt: new Date(NOW - daysAgo * DAY).toISOString(),
    dimensions: [],
  };
}

// newest-first. r17 scores sit 20 points above r18 ones: the bump, not a decline.
const crossing = [pt(0, 50, "r18"), pt(10, 49, "r18"), pt(20, 48, "r18"), pt(30, 70, "r17"), pt(40, 69, "r17")];

describe("fitTrendForecast — the ruler", () => {
  it("fits only the trailing same-rubric run", () => {
    const f = fitTrendForecast(crossing, NOW)!;
    expect(f.points).toBe(3);
    expect(f.spanDays).toBe(20);
    expect(f.perWeek).toBeGreaterThan(0); // the r17 → r18 cliff is not in the slope
  });

  it("returns null when the run under the current rubric is too short", () => {
    expect(fitTrendForecast([pt(0, 50, "r18"), pt(10, 70, "r17"), pt(20, 69, "r17")], NOW)).toBeNull();
  });

  it("a null rubric never breaks the run", () => {
    const f = fitTrendForecast([pt(0, 50, "r18"), pt(10, 49, null), pt(20, 48, "r18")], NOW)!;
    expect(f.points).toBe(3);
  });

  it("rubricTruncation names the run used, the history it left out and the rubric", () => {
    expect(rubricTruncation(crossing)).toEqual({ used: 3, total: 5, rubric: "r18" });
    expect(rubricTruncation([pt(0, 50, "r18"), pt(10, 49, "r18")])).toBeNull();
  });
});
