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

import { buildScoreBadges, buildTrendPoints, type StandingSource } from "@/features/standing/overview/overviewStanding";
import { levelForScore } from "@/lib/maturity/model";

const BASE: StandingSource = {
  avgOverall: 62,
  avgAdoption: 55,
  avgRigor: 70,
  scannedCount: 12,
  repoCount: 40,
  deltas: null,
  realScoredCount: 12,
  mockCount: 0,
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

describe("buildScoreBadges — every period delta states its basis", () => {
  const MOVED: StandingSource = { ...BASE, deltas: { overall: 4, adoption: -2, rigor: 0 } };

  it("carries the window's canonical comparison label onto every arrow it renders", () => {
    const [maturity, adoption, rigor, coverage] = buildScoreBadges(MOVED, "vs 30d ago");
    expect(maturity!.deltaLabel).toBe("vs 30d ago");
    expect(adoption!.deltaLabel).toBe("vs 30d ago");
    expect(rigor!.deltaLabel).toBe("vs 30d ago");
    // The coverage badge has no delta, so it has no basis to state.
    expect(coverage!.deltaLabel).toBeUndefined();
  });

  it("omits the label rather than inventing one when the window has no comparison", () => {
    // "All time": ResolvedWindow.comparisonLabel is "", and there is no baseline either — so no
    // arrow renders. A basis must degrade to ABSENCE, never to a fabricated one.
    expect(buildScoreBadges(MOVED, "")[0]!.deltaLabel).toBeUndefined();
    expect(buildScoreBadges(MOVED)[0]!.deltaLabel).toBeUndefined();
  });

  it("still passes the deltas themselves through untouched", () => {
    expect(buildScoreBadges(MOVED, "vs quarter start").map((b) => b.delta)).toEqual([4, -2, 0, undefined]);
  });
});

describe("buildScoreBadges — the average's basis travels with it", () => {
  it("titles every score badge with the denominator it was measured over", () => {
    const [maturity, adoption, rigor, coverage] = buildScoreBadges(BASE);
    for (const b of [maturity, adoption, rigor]) expect(b!.title).toBe("Average over the 12 live-scored repos");
    expect(coverage!.title).toBeUndefined(); // a count is not an average — it has no basis to state
  });

  it("discloses the excluded mock placeholders on the headline badge, in the cohort card's words", () => {
    const mixed = { ...BASE, scannedCount: 12, realScoredCount: 9, mockCount: 3 };
    const [maturity, adoption] = buildScoreBadges(mixed);
    expect(maturity!.note).toBe("3 mock (excluded from avg)");
    expect(maturity!.title).toBe("Average over the 9 live-scored repos · 3 mock placeholders excluded");
    // One chip, not three copies of one fact.
    expect(adoption!.note).toBeUndefined();
  });

  it("singularizes the denominator and the exclusion", () => {
    const one = { ...BASE, realScoredCount: 1, mockCount: 1 };
    expect(buildScoreBadges(one)[0]!.title).toBe("Average over the 1 live-scored repo · 1 mock placeholder excluded");
    expect(buildScoreBadges(one)[0]!.note).toBe("1 mock (excluded from avg)");
  });

  it("shows NO score — never a 0 — when nothing in the set was live-scored", () => {
    // `avgOverall` is `roundedMean([])` here: a division guard, not a grade. A 0 rendered in
    // scoreHex(0) alarm-red would assert a catastrophic fleet grade over a fleet nobody graded.
    const allMock = { ...BASE, avgOverall: 0, avgAdoption: 0, avgRigor: 0, realScoredCount: 0, mockCount: 12, deltas: { overall: 4, adoption: 2, rigor: 1 } };
    const [maturity, adoption, rigor] = buildScoreBadges(allMock);
    for (const b of [maturity, adoption, rigor]) {
      expect(b!.value).toBe("—");
      expect(b!.color).toBeUndefined();
      expect(b!.delta).toBeUndefined(); // no cohort, so no movement to claim either
    }
    expect(maturity!.sub).toBeUndefined(); // and no level band for a score that does not exist
    expect(maturity!.title).toBe("No live-scored repositories in this set (all 12 carry a deterministic mock score)");
  });

  it("leaves an all-live fleet's badges exactly as they were", () => {
    const [maturity] = buildScoreBadges(BASE);
    expect(maturity!.value).toBe(62);
    expect(maturity!.note).toBeUndefined();
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
