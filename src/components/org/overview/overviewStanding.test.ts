// Pins the Overview standing strip's derivation (overviewStanding.ts). Two things carry the
// narrative and neither is obvious from the render:
//   1. the maturity badge's `sub` is the LEVEL BAND of the fleet average — a band drift silently
//      relabels every org's headline;
//   2. `delta` is the rollup's COHORT-MATCHED movement, not current-minus-anything. A regression
//      that recomputed it from the fleet averages would make a mid-period onboarding wave read as
//      improvement, which is the exact failure `deltas` exists to prevent.
// Plus: the coverage badge is scanned/total (a 62 over 3 of 40 repos is a different claim), and no
// badge ever carries a `goal` — goal pacing needs `listGoals`, a query the Overview must not make.

import { describe, expect, it } from "vitest";

import { buildScoreBadges, buildTrendPoints, type StandingSource } from "@/components/org/overview/overviewStanding";
import { levelForScore } from "@/lib/maturity/model";

const BASE: StandingSource = {
  avgOverall: 62,
  avgAdoption: 55,
  avgRigor: 70,
  scannedCount: 12,
  repoCount: 40,
  deltas: null,
};

describe("buildScoreBadges", () => {
  it("emits the four headline badges in reading order", () => {
    expect(buildScoreBadges(BASE).map((b) => b.label)).toEqual([
      "Org maturity",
      "AI Adoption",
      "Engineering Rigor",
      "Repos scanned",
    ]);
  });

  it("labels org maturity with the canonical level band of the fleet average", () => {
    const level = levelForScore(BASE.avgOverall);
    const [maturity] = buildScoreBadges(BASE);
    expect(maturity!.value).toBe(62);
    expect(maturity!.sub).toBe(`${level.id} · ${level.name}`);
  });

  it("reports coverage as scanned/total, with no delta arrow", () => {
    const coverage = buildScoreBadges(BASE)[3]!;
    expect(coverage.value).toBe("12/40");
    expect(coverage.delta).toBeUndefined();
  });

  it("passes the rollup's cohort-matched deltas straight through, per metric", () => {
    const badges = buildScoreBadges({ ...BASE, deltas: { overall: 4, adoption: -2, rigor: 0 } });
    expect(badges.map((b) => b.delta)).toEqual([4, -2, 0, undefined]);
  });

  it("hides every delta when the window has no baseline", () => {
    // `deltas: null` is "All time" / no baseline. Deltas must be ABSENT, never 0 — a rendered "▲0"
    // would assert the fleet held flat over a period that was never compared.
    expect(buildScoreBadges(BASE).every((b) => b.delta == null)).toBe(true);
  });

  it("never emits a goal qualifier — goal pacing needs a query the Overview does not make", () => {
    const badges = buildScoreBadges({ ...BASE, deltas: { overall: 4, adoption: 1, rigor: 1 } });
    expect(badges.every((b) => b.goal === undefined)).toBe(true);
  });
});

describe("buildTrendPoints", () => {
  it("maps the daily rollup series to score/at points", () => {
    expect(buildTrendPoints([{ date: "2026-01-01", avg: 50 }, { date: "2026-01-02", avg: 54 }])).toEqual([
      { score: 50, at: "2026-01-01" },
      { score: 54, at: "2026-01-02" },
    ]);
  });

  it("leaves org points non-interactive — a per-day average has no single scan to link to", () => {
    const [p] = buildTrendPoints([{ date: "2026-01-01", avg: 50 }]);
    expect(p!.href).toBeUndefined();
    expect(p!.engine).toBeUndefined();
    expect(p!.sha).toBeUndefined();
  });

  it("passes an empty series through (the sparkline hides itself below two points)", () => {
    expect(buildTrendPoints([])).toEqual([]);
  });
});
