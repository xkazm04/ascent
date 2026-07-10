// Medium coverage gap (test-mastery-2026-06-18, org-overview-standing #5): the "Quarter in review"
// banner (PeriodSummary.tsx) is the first sentence a leader reads, and its headline number + prose are
// derived inline from the rollup's cohort-matched deltas. Two numbers carry the narrative:
//   cohortNow = baseline.avgOverall + deltas.overall   (NOT rollup.avgOverall, the fleet-wide avg)
//   onboarded = max(0, rollup.scannedCount - baseline.repos)
// plus the promoted/demoted tallies off movers.levelChanges, and a null-render when there is no
// baseline ("All time" range). A regression that swaps cohortNow for the fleet-wide average makes the
// banner's "climbed +X to Y" sentence stop reconciling with the cohort-matched delta shown next to it —
// the prose says one thing, the big number another — and onboarding repos leak into a fabricated
// movement. None of that was pinned.
//
// This Vitest setup has no jsdom/RTL, and per the task we make NO source change, so we cannot extract a
// helper or render the component. Instead `derivePeriodSummary` below mirrors PeriodSummary.tsx's inline
// derivation EXACTLY (lines 22-41) — the assertions pin the relationships the component computes. The
// cohort side is additionally driven through the REAL computeWindowDeltas on a crafted fleet, so the
// cohortNow = baseline.avgOverall + deltas.overall identity is verified end-to-end, not just restated.
//
// The client mock keeps the import chain side-effect-free (computeWindowDeltas is pure; it never touches
// the DB) so this suite never reaches for a database.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ getPrisma: vi.fn(), isDbConfigured: () => false }));

import { computeWindowDeltas, type RepoScoreSnap } from "@/lib/db/org-rollup";
import { isWithinNoise } from "@/lib/maturity/noise";
import type { OrgMovers, OrgRollup, RepoMove } from "@/lib/db";

// ── Mirror of PeriodSummary.tsx's inline derivation (lines 22-41). ─────────────────────────────────
// Returns the no-render signal (null) when there is no baseline/deltas, else the derived numbers and
// the two sentence fragments the component renders. Kept line-aligned with the component so a future
// extraction can drop straight in and these tests still pin it.
interface Derived {
  cohortNow: number;
  onboarded: number;
  promoted: number;
  demoted: number;
  maturity: string;
  levels: string;
}
function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
const signedDelta = (d: number): string => `${d > 0 ? "+" : ""}${d}`;

function derivePeriodSummary(rollup: OrgRollup, movers: OrgMovers | null): Derived | null {
  const { baseline, deltas } = rollup;
  if (!baseline || !deltas) return null; // the "All time" range — component returns null (renders nothing)

  const promoted = movers?.levelChanges.filter((m) => m.levelDelta > 0).length ?? 0;
  const demoted = movers?.levelChanges.filter((m) => m.levelDelta < 0).length ?? 0;
  const cohortNow = baseline.avgOverall + deltas.overall;
  const onboarded = Math.max(0, rollup.scannedCount - baseline.repos);

  const maturity = isWithinNoise(deltas.overall)
    ? deltas.overall === 0
      ? `Fleet maturity held at ${cohortNow}.`
      : `Fleet maturity held around ${cohortNow} — the ${signedDelta(deltas.overall)} shift is within the scan-to-scan noise band.`
    : `Fleet maturity ${deltas.overall > 0 ? "climbed" : "slipped"} ${signedDelta(deltas.overall)} to ${cohortNow} (from ${baseline.avgOverall}).`;

  const levels =
    promoted || demoted
      ? `${promoted ? `${promoted} ${plural(promoted, "repo")} leveled up` : ""}${promoted && demoted ? ", " : ""}${demoted ? `${demoted} slipped a level` : ""}.`
      : "No level changes across the fleet.";

  return { cohortNow, onboarded, promoted, demoted, maturity, levels };
}

// ── Fixture builders ──────────────────────────────────────────────────────────────────────────────
const snap = (repoId: string, overall: number, adoption = overall, rigor = overall): RepoScoreSnap => ({
  repoId,
  overall,
  adoption,
  rigor,
});

/** A minimal OrgRollup carrying only the fields PeriodSummary reads (scannedCount, avgOverall, baseline, deltas). */
function rollup(over: {
  scannedCount: number;
  avgOverall: number; // fleet-wide avg — a decoy the banner must NOT use as the "to"
  baseline: OrgRollup["baseline"];
  deltas: OrgRollup["deltas"];
}): OrgRollup {
  return {
    org: "acme",
    repoCount: over.scannedCount,
    scannedCount: over.scannedCount,
    avgOverall: over.avgOverall,
    avgAdoption: 0,
    avgRigor: 0,
    postureCounts: {},
    dimAverages: [],
    repos: [],
    trend: [],
    forecast: null,
    baseline: over.baseline,
    deltas: over.deltas,
  };
}

function baseline(repos: number, avgOverall: number): NonNullable<OrgRollup["baseline"]> {
  return { asOf: "2026-03-01T00:00:00.000Z", repos, avgOverall, avgAdoption: avgOverall, avgRigor: avgOverall };
}

/** A RepoMove carrying only the field the level tallies read (levelDelta); the rest is filler. */
function move(levelDelta: number): RepoMove {
  return {
    fullName: "acme/r",
    name: "r",
    overall: 0,
    dOverall: 0,
    dAdoption: 0,
    dRigor: 0,
    levelFrom: "L2",
    levelTo: "L2",
    levelDelta,
    postureFrom: "manual",
    postureTo: "manual",
    sinceDays: 1,
  };
}
function movers(...levelDeltas: number[]): OrgMovers {
  const levelChanges = levelDeltas.map(move);
  return { gainers: [], regressers: [], levelChanges, comparedRepos: levelChanges.length };
}

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
