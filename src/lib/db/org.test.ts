import { describe, expect, it } from "vitest";
import { dueBucketFor } from "@/lib/db/org";
import { computeWindowDeltas, type RepoScoreSnap } from "@/lib/db/org-rollup";

// Pure due-date bucketing behind the org backlog's "by due date" grouping. UTC date-only dates keep
// these assertions free of the runner's local timezone.
describe("dueBucketFor", () => {
  const now = new Date("2026-06-02T12:00:00Z");
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

  it("buckets a missing due date as no_date", () => {
    expect(dueBucketFor(null, now)).toBe("no_date");
  });

  it("buckets a past date as overdue", () => {
    expect(dueBucketFor(day("2026-06-01"), now)).toBe("overdue");
    expect(dueBucketFor(day("2026-01-01"), now)).toBe("overdue");
  });

  it("buckets today and the next 7 days as this_week", () => {
    expect(dueBucketFor(day("2026-06-02"), now)).toBe("this_week"); // today (d=0)
    expect(dueBucketFor(day("2026-06-09"), now)).toBe("this_week"); // d=7 (inclusive)
  });

  it("buckets 8..31 days out as this_month", () => {
    expect(dueBucketFor(day("2026-06-10"), now)).toBe("this_month"); // d=8
    expect(dueBucketFor(day("2026-07-03"), now)).toBe("this_month"); // d=31 (inclusive)
  });

  it("buckets beyond ~a month as later", () => {
    expect(dueBucketFor(day("2026-07-04"), now)).toBe("later"); // d=32
    expect(dueBucketFor(day("2027-01-01"), now)).toBe("later");
  });

  it("treats the due date as date-only (time of day on `now` doesn't shift the bucket)", () => {
    const lateInDay = new Date("2026-06-02T23:59:59Z");
    expect(dueBucketFor(day("2026-06-02"), lateInDay)).toBe("this_week"); // still today, not overdue
  });
});

// Cohort-matched period deltas (biz-bug-scan-2026-06-11, org-dashboard #2): movement is measured
// only over repos present on both sides of the window, so onboarding repos mid-period reads as
// growth — not fabricated fleet "slippage" that contradicts the movers panel.
describe("computeWindowDeltas", () => {
  const snap = (repoId: string, overall: number, adoption = overall, rigor = overall): RepoScoreSnap => ({
    repoId,
    overall,
    adoption,
    rigor,
  });

  it("does not fabricate movement when low-scoring repos onboard mid-period", () => {
    // 3 mature repos at 80 before the quarter; 5 new repos at 40 onboard during it. The naive
    // fleet-avg comparison reported (3·80 + 5·40)/8 − 80 = −25; no repo actually moved.
    const baseline = [snap("a", 80), snap("b", 80), snap("c", 80)];
    const current = [...baseline, snap("d", 40), snap("e", 40), snap("f", 40), snap("g", 40), snap("h", 40)];
    expect(computeWindowDeltas(current, baseline)).toEqual({ overall: 0, adoption: 0, rigor: 0 });
  });

  it("measures real movement within the matched cohort", () => {
    const baseline = [snap("a", 70, 60, 80), snap("b", 50, 40, 60)];
    const current = [snap("a", 80, 70, 90), snap("b", 50, 40, 60), snap("new", 95)];
    expect(computeWindowDeltas(current, baseline)).toEqual({ overall: 5, adoption: 5, rigor: 5 });
  });

  it("ignores baseline repos that vanished from the current side (both sides cohort-filtered)", () => {
    const baseline = [snap("a", 80), snap("gone", 10)];
    const current = [snap("a", 85)];
    expect(computeWindowDeltas(current, baseline)).toEqual({ overall: 5, adoption: 5, rigor: 5 });
  });

  it("returns null when the cohorts don't overlap", () => {
    expect(computeWindowDeltas([snap("x", 50)], [snap("y", 60)])).toBeNull();
    expect(computeWindowDeltas([], [snap("y", 60)])).toBeNull();
    expect(computeWindowDeltas([snap("x", 50)], [])).toBeNull();
  });
});
