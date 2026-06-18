// Critical coverage gap (test-mastery-2026-06-18, org-overview-standing #1): computeWindowDeltas is
// the cohort-matched period delta behind the dashboard's headline "net maturity ▲" tile, the
// per-tile period deltas, the "Quarter in review" banner, and the weekly digest number — and it had
// ZERO tests despite a code comment documenting the exact past bug it exists to prevent: onboarding
// low-scoring repos mid-quarter used to read as the whole fleet "slipping" ~25 points that no
// individual repo experienced (and onboarding strong repos manufactured a fake climb). The entire
// reason the function exists is the cohort-intersection invariant — movement is measured ONLY over
// repos present on BOTH sides of the window — so that is what these tests lock in.
//
// The function is pure; it takes plain RepoScoreSnap arrays and needs no DB. The mock below keeps the
// module import side-effect-free (defensive — the client is only touched inside the async query
// functions, not at module load) so this suite never reaches for a database.

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ getPrisma: vi.fn(), isDbConfigured: () => false }));

import { computeWindowDeltas, type RepoScoreSnap } from "@/lib/db/org-rollup";

/** Terse snapshot builder: same overall/adoption/rigor unless overridden. */
function snap(repoId: string, overall: number, adoption = overall, rigor = overall): RepoScoreSnap {
  return { repoId, overall, adoption, rigor };
}

describe("computeWindowDeltas — cohort matching", () => {
  it("measures only repos present in BOTH windows (real before->after delta)", () => {
    // A and B exist on both sides; their real movement is A 70->80 (+10), B 80->90 (+10).
    const current = [snap("A", 80), snap("B", 90)];
    const baseline = [snap("A", 70), snap("B", 80)];
    expect(computeWindowDeltas(current, baseline)).toEqual({
      overall: 10,
      adoption: 10,
      rigor: 10,
    });
  });

  it("EXCLUDES a newly-onboarded repo (after-only) — no fabricated fleet slip", () => {
    // THE DOCUMENTED BUG. A=70->80 and B=80->90 (both +10); C is brand new this window at 10.
    // Averaging the whole current fleet [80,90,10]=60 against the baseline cohort [70,80]=75 would
    // report a phantom -15 "slip" that no repo experienced. The cohort intersection must drop C and
    // report the true +10 the matched repos actually moved.
    const current = [snap("A", 80), snap("B", 90), snap("C", 10)];
    const baseline = [snap("A", 70), snap("B", 80)];
    const result = computeWindowDeltas(current, baseline);
    expect(result).toEqual({ overall: 10, adoption: 10, rigor: 10 });
    // Explicitly: the onboarded low-scorer did NOT drag the headline negative.
    expect(result!.overall).toBeGreaterThan(0);
  });

  it("EXCLUDES a strong newly-onboarded repo too — no fabricated fleet climb", () => {
    // Symmetric guard: a high-scoring new repo must not manufacture a fake climb either.
    // Matched cohort A,B is flat (70->70, 80->80) => +0; the new C=100 must not inflate it.
    const current = [snap("A", 70), snap("B", 80), snap("C", 100)];
    const baseline = [snap("A", 70), snap("B", 80)];
    expect(computeWindowDeltas(current, baseline)).toEqual({ overall: 0, adoption: 0, rigor: 0 });
  });

  it("EXCLUDES a dropped repo (before-only) — it leaves the cohort, not the math", () => {
    // D was scored in the baseline but is gone from the current window. The cohort is just A,B,
    // moving 70->80 and 80->90 (+10). D's baseline 0 must not be averaged into the "before" side.
    const current = [snap("A", 80), snap("B", 90)];
    const baseline = [snap("A", 70), snap("B", 80), snap("D", 0)];
    expect(computeWindowDeltas(current, baseline)).toEqual({
      overall: 10,
      adoption: 10,
      rigor: 10,
    });
  });

  it("tracks each dimension's cohort delta independently", () => {
    // overall/adoption/rigor are averaged and differenced per-dimension, not collapsed.
    const current = [snap("A", 80, 60, 40), snap("B", 90, 50, 30)];
    const baseline = [snap("A", 70, 50, 50), snap("B", 80, 40, 30)];
    expect(computeWindowDeltas(current, baseline)).toEqual({
      overall: 10, // avg(80,90)=85 - avg(70,80)=75
      adoption: 10, // avg(60,50)=55 - avg(50,40)=45
      rigor: -5, // avg(40,30)=35 - avg(50,30)=40
    });
  });
});

describe("computeWindowDeltas — no-overlap / empty windows", () => {
  it("returns null when the cohorts don't overlap at all", () => {
    // current C,D vs baseline A,B — no shared repoId, so there is no movement to report.
    const current = [snap("C", 50), snap("D", 60)];
    const baseline = [snap("A", 70), snap("B", 80)];
    expect(computeWindowDeltas(current, baseline)).toBeNull();
  });

  it("returns null when the current window is empty", () => {
    expect(computeWindowDeltas([], [snap("A", 70)])).toBeNull();
  });

  it("returns null when the baseline window is empty", () => {
    expect(computeWindowDeltas([snap("A", 70)], [])).toBeNull();
  });

  it("returns null when both windows are empty (no NaN, no throw)", () => {
    expect(computeWindowDeltas([], [])).toBeNull();
  });

  it("returns a zero delta (never NaN) for an unchanged overlapping cohort", () => {
    const same = [snap("A", 70), snap("B", 80)];
    const result = computeWindowDeltas(same, same.map((s) => ({ ...s })));
    expect(result).toEqual({ overall: 0, adoption: 0, rigor: 0 });
    expect(Number.isNaN(result!.overall)).toBe(false);
  });
});

describe("computeWindowDeltas — rounding", () => {
  it("rounds each cohort AVERAGE before differencing (Math.round, not the raw mean)", () => {
    // avg(70,71)=70.5 -> Math.round -> 71; baseline avg(70,70)=70. Delta is +1, not +0.5.
    const current = [snap("A", 70), snap("B", 71)];
    const baseline = [snap("A", 70), snap("B", 70)];
    expect(computeWindowDeltas(current, baseline)!.overall).toBe(1);
  });

  it("differences the two rounded averages (each side rounded independently)", () => {
    // now avg(70,71)=70.5->71 ; before avg(60,61)=60.5->61 ; delta 71-61 = 10.
    const current = [snap("A", 70), snap("B", 71)];
    const baseline = [snap("A", 60), snap("B", 61)];
    expect(computeWindowDeltas(current, baseline)!.overall).toBe(10);
  });
});
