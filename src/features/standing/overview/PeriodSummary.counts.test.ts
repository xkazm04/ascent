// The counting half of the PeriodSummary coverage (split out of PeriodSummary.test.ts to keep both
// suites inside the 200-LOC file cap): the onboarded-this-period count, the promoted/demoted tallies
// off movers.levelChanges, and the null-render when there is no baseline ("All time" range). The
// cohort-maths half — cohortNow and the banner sentence — lives in PeriodSummary.test.ts, whose header
// carries the full story of why this file exists and why it survived the Overview's orphan sweep.
//
// `derivePeriodSummary` and the fixture builders are shared from PeriodSummary.fixtures.ts and mirror
// PeriodSummary.tsx's inline derivation EXACTLY (lines 22-41).
//
// The client mock keeps the import chain side-effect-free (computeWindowDeltas is pure; it never touches
// the DB) so this suite never reaches for a database.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ getPrisma: vi.fn(), isDbConfigured: () => false }));

import { computeWindowDeltas } from "@/lib/db/org-rollup";
import { baseline, derivePeriodSummary, movers, rollup, signedDelta, snap } from "./PeriodSummary.fixtures";

describe("PeriodSummary derivation — onboarded-this-period count (growth, not a movement)", () => {
  it("counts a repo onboarded MID-WINDOW as onboarded (it never drags the cohort delta)", () => {
    // The same crafted fleet: A,B are the cohort (+10), C onboarded mid-window. C must be reported as
    // ONE onboarded repo (growth), and the cohort delta stays a clean +10 with no false slip from C.
    const current = [snap("A", 80), snap("B", 90), snap("C", 10)];
    const before = [snap("A", 70), snap("B", 80)];
    const deltas = computeWindowDeltas(current, before)!;
    const r = rollup({ scannedCount: 3, avgOverall: 60, baseline: baseline(2, 75), deltas });
    const d = derivePeriodSummary(r, movers())!;

    expect(d.onboarded).toBe(1); // scannedCount 3 - baseline.repos 2
    expect(r.deltas!.overall).toBe(10); // and the onboarded repo did NOT create a movement
  });

  it("onboarded === scannedCount - baseline.repos when the current fleet grew", () => {
    const r = rollup({ scannedCount: 7, avgOverall: 70, baseline: baseline(4, 68), deltas: { overall: 2, adoption: 1, rigor: 3 } });
    const d = derivePeriodSummary(r, movers())!;
    expect(d.onboarded).toBe(3); // 7 - 4
  });

  it("clamps onboarded at 0 when the cohort SHRANK (baseline.repos > scannedCount) — no '+-2 onboarded' string", () => {
    // A repo present at baseline that has no current scan would make scannedCount - baseline.repos
    // negative. Math.max(0, …) must floor it so the banner never renders a negative onboarded count.
    const r = rollup({ scannedCount: 2, avgOverall: 80, baseline: baseline(4, 78), deltas: { overall: 1, adoption: 0, rigor: 0 } });
    const d = derivePeriodSummary(r, movers())!;
    expect(d.onboarded).toBe(0); // max(0, 2 - 4)
    expect(signedDelta(-2)).toBe("-2"); // sanity: a raw -2 WOULD have rendered "-2" — the clamp prevents it
  });

  it("onboarded is 0 when the fleet exactly matches the baseline cohort (no growth)", () => {
    const r = rollup({ scannedCount: 4, avgOverall: 70, baseline: baseline(4, 70), deltas: { overall: 0, adoption: 0, rigor: 0 } });
    expect(derivePeriodSummary(r, movers())!.onboarded).toBe(0);
  });
});

describe("PeriodSummary derivation — promoted/demoted tallies off movers.levelChanges", () => {
  it("promoted counts only levelDelta > 0; demoted only levelDelta < 0 (a 0-delta is neither)", () => {
    const r = rollup({ scannedCount: 3, avgOverall: 70, baseline: baseline(3, 68), deltas: { overall: 2, adoption: 0, rigor: 0 } });
    const d = derivePeriodSummary(r, movers(1, 2, -1, 0))!; // two up, one down, one flat
    expect(d.promoted).toBe(2);
    expect(d.demoted).toBe(1);
    expect(d.levels).toBe("2 repos leveled up, 1 slipped a level.");
  });

  it("singular 'repo' for a single promotion, and the no-change copy when nothing leveled", () => {
    const r = rollup({ scannedCount: 2, avgOverall: 70, baseline: baseline(2, 69), deltas: { overall: 1, adoption: 0, rigor: 0 } });
    expect(derivePeriodSummary(r, movers(1))!.levels).toBe("1 repo leveled up.");
    expect(derivePeriodSummary(r, movers())!.levels).toBe("No level changes across the fleet.");
  });

  it("treats null movers as zero level changes (no throw)", () => {
    const r = rollup({ scannedCount: 2, avgOverall: 70, baseline: baseline(2, 70), deltas: { overall: 0, adoption: 0, rigor: 0 } });
    const d = derivePeriodSummary(r, null)!;
    expect(d.promoted).toBe(0);
    expect(d.demoted).toBe(0);
    expect(d.levels).toBe("No level changes across the fleet.");
  });
});

describe("PeriodSummary derivation — no-baseline / empty (the 'All time' range)", () => {
  it("returns the no-render signal (null) when there is no baseline", () => {
    const r = rollup({ scannedCount: 5, avgOverall: 70, baseline: null, deltas: { overall: 3, adoption: 1, rigor: 2 } });
    expect(derivePeriodSummary(r, movers(1))).toBeNull();
  });

  it("returns the no-render signal (null) when there are no deltas (no cohort overlap)", () => {
    expect(derivePeriodSummary(rollup({ scannedCount: 5, avgOverall: 70, baseline: baseline(5, 68), deltas: null }), movers(1))).toBeNull();
  });

  it("an empty fleet with no baseline renders nothing (documented zero — never a fabricated banner)", () => {
    const empty = rollup({ scannedCount: 0, avgOverall: 0, baseline: null, deltas: null });
    expect(derivePeriodSummary(empty, null)).toBeNull();
  });
});
