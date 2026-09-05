// NOTE (2026-07-09): PeriodSummary.tsx itself was deleted — it had been unreferenced since the Org
// Overview refactor (org-overview-standing #2). This file survives because it never imported the
// component: it pins the LIB derivations the banner was built on (computeWindowDeltas, isWithinNoise),
// which are still live and still carry the narrative. Restore the component from git if it is ever
// wanted again; the maths below is what actually needed the coverage.
//
// RE-AFFIRMED (2026-08-03, org-overview-standing): the Overview's orphan sweep re-checked this file
// and KEPT it. It is not a test of dead code — `computeWindowDeltas` is what produces
// `OrgRollup.deltas`, which the standing strip now renders on the front page (overviewStanding.ts),
// and `isWithinNoise` still gates every "did this really move?" verdict in the org surfaces. Deleting
// it would drop the only end-to-end coverage of the cohort-matching identity below. Do not re-open
// this as "an orphan test" — the component it once mirrored is already gone.
//
// Medium coverage gap (test-mastery-2026-06-18, org-overview-standing #5): the "Quarter in review"
// banner's headline number + prose were derived from the rollup's cohort-matched deltas. Two numbers
// carry the narrative:
//   cohortNow = baseline.avgOverall + deltas.overall   (NOT rollup.avgOverall, the fleet-wide avg)
//   onboarded = max(0, rollup.scannedCount - baseline.repos)
// plus the promoted/demoted tallies off movers.levelChanges, and a null-render when there is no
// baseline ("All time" range). A regression that swaps cohortNow for the fleet-wide average makes the
// banner's "climbed +X to Y" sentence stop reconciling with the cohort-matched delta shown next to it —
// the prose says one thing, the big number another — and onboarding repos leak into a fabricated
// movement. None of that was pinned.
//
// This Vitest setup has no jsdom/RTL, and per the task we make NO source change, so we cannot extract a
// helper or render the component. Instead `derivePeriodSummary` (in PeriodSummary.fixtures.ts, shared
// with PeriodSummary.counts.test.ts) mirrors PeriodSummary.tsx's inline derivation EXACTLY (lines 22-41)
// — the assertions pin the relationships the component computes. The cohort side is additionally driven
// through the REAL computeWindowDeltas on a crafted fleet, so the cohortNow = baseline.avgOverall +
// deltas.overall identity is verified end-to-end, not just restated.
//
// This file holds the COHORT-MATHS half (cohortNow and the banner sentence). The counting half — the
// onboarded count, the promoted/demoted tallies and the no-baseline null-render — is in
// PeriodSummary.counts.test.ts; the two were split only to stay inside the 200-LOC file cap.
//
// The client mock keeps the import chain side-effect-free (computeWindowDeltas is pure; it never touches
// the DB) so this suite never reaches for a database.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ getPrisma: vi.fn(), isDbConfigured: () => false }));

import { computeWindowDeltas } from "@/lib/db/org-rollup";
import { isWithinNoise } from "@/lib/maturity/noise";
import { baseline, derivePeriodSummary, movers, rollup, snap } from "./PeriodSummary.fixtures";

describe("PeriodSummary derivation — cohort-now is the cohort's current avg, NOT the fleet-wide avg", () => {
  it("cohortNow === baseline.avgOverall + deltas.overall, driven through the real computeWindowDeltas", () => {
    // Crafted fleet: A 70->80, B 80->90 stay in the cohort (real +10); C is onboarded mid-window at 10.
    // The fleet-wide avg folds C in: avg(80,90,10)=60. The banner must report the COHORT's current
    // average (baseline 75 + delta 10 = 85), never 60.
    const current = [snap("A", 80), snap("B", 90), snap("C", 10)];
    const before = [snap("A", 70), snap("B", 80)];
    const deltas = computeWindowDeltas(current, before);
    expect(deltas).toEqual({ overall: 10, adoption: 10, rigor: 10 }); // C excluded from the cohort delta

    const r = rollup({
      scannedCount: 3, // A, B, C all scanned now
      avgOverall: 60, // the DECOY fleet-wide avg (folds C in) — must not be the sentence's "to"
      baseline: baseline(2, 75), // cohort baseline avg(70,80)=75
      deltas,
    });
    const d = derivePeriodSummary(r, movers())!;

    expect(d.cohortNow).toBe(85); // 75 + 10 — the cohort's current avg
    expect(d.cohortNow).toBe(r.baseline!.avgOverall + r.deltas!.overall);
    expect(d.cohortNow).not.toBe(r.avgOverall); // explicitly NOT the fleet-wide 60
  });

  it("the sentence's headline numbers reconcile with the cohort math (no prose/number contradiction)", () => {
    const current = [snap("A", 80), snap("B", 90), snap("C", 10)];
    const before = [snap("A", 70), snap("B", 80)];
    const deltas = computeWindowDeltas(current, before)!;
    const r = rollup({ scannedCount: 3, avgOverall: 60, baseline: baseline(2, 75), deltas });
    const d = derivePeriodSummary(r, movers())!;

    // "climbed +10 to 85 (from 75)" — every number in the prose is the cohort number, not the fleet avg.
    expect(d.maturity).toBe("Fleet maturity climbed +10 to 85 (from 75).");
    expect(d.maturity).toContain(`to ${d.cohortNow}`);
    expect(d.maturity).toContain(`from ${r.baseline!.avgOverall}`);
    expect(d.maturity).not.toContain("60"); // the fleet-wide avg never appears in the banner sentence
  });

  it("a cohort that slipped reads 'slipped -N to <lower>' with the cohort numbers", () => {
    const current = [snap("A", 60), snap("B", 70)];
    const before = [snap("A", 70), snap("B", 80)];
    const deltas = computeWindowDeltas(current, before)!; // -10
    const r = rollup({ scannedCount: 2, avgOverall: 65, baseline: baseline(2, 75), deltas });
    const d = derivePeriodSummary(r, movers())!;
    expect(d.cohortNow).toBe(65);
    expect(d.maturity).toBe("Fleet maturity slipped -10 to 65 (from 75).");
  });

  it("a flat cohort reads 'held at <avg>' (no signed delta, no false movement)", () => {
    const same = [snap("A", 70), snap("B", 80)];
    const deltas = computeWindowDeltas(same, same.map((s) => ({ ...s })))!; // 0
    const r = rollup({ scannedCount: 2, avgOverall: 75, baseline: baseline(2, 75), deltas });
    const d = derivePeriodSummary(r, movers())!;
    expect(d.cohortNow).toBe(75);
    expect(d.maturity).toBe("Fleet maturity held at 75.");
  });

  it("a within-noise non-zero delta reads 'held around …' and names the noise band (no false climb)", () => {
    // +1 is inside the scan-to-scan band (two identical-commit claude-cli re-scans moved 0/±1) — the
    // banner must NOT say "climbed +1", which would present a re-scan wobble as real fleet movement.
    const r = rollup({ scannedCount: 2, avgOverall: 76, baseline: baseline(2, 75), deltas: { overall: 1, adoption: 1, rigor: 0 } });
    const d = derivePeriodSummary(r, movers())!;
    expect(isWithinNoise(1)).toBe(true);
    expect(d.cohortNow).toBe(76);
    expect(d.maturity).toBe("Fleet maturity held around 76 — the +1 shift is within the scan-to-scan noise band.");
    expect(d.maturity).not.toContain("climbed");
  });
});

