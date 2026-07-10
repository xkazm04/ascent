import { describe, expect, it, vi } from "vitest";
import { claimRepoScan, dueBucketFor, releaseRepoScan } from "@/lib/db/org";
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

  // ---- boundary edges: pin the exact day each bucket flips, tied to the dueInDays sign. The
  // invariant on the board is `dueInDays < 0` ⇔ bucket `overdue`, so the today (d=0) vs.
  // yesterday (d=-1) edge must not drift if daysUntil's Math.round ever becomes Math.floor.
  // `now` is fixed at 2026-06-02 (UTC date-only), so every assertion is deterministic — no
  // wall-clock, no fake timers needed.
  it("flips overdue→this_week exactly at the today boundary (d=-1 vs d=0)", () => {
    expect(dueBucketFor(day("2026-06-01"), now)).toBe("overdue"); // d=-1: strictly past ⇒ overdue
    expect(dueBucketFor(day("2026-06-02"), now)).toBe("this_week"); // d=0: today is NOT overdue
  });

  it("flips this_week→this_month exactly at d=7 vs d=8", () => {
    expect(dueBucketFor(day("2026-06-09"), now)).toBe("this_week"); // d=7: last day inside the week
    expect(dueBucketFor(day("2026-06-10"), now)).toBe("this_month"); // d=8: first day of this_month
  });

  it("flips this_month→later exactly at d=31 vs d=32", () => {
    expect(dueBucketFor(day("2026-07-03"), now)).toBe("this_month"); // d=31: last day inside the month
    expect(dueBucketFor(day("2026-07-04"), now)).toBe("later"); // d=32: first day of later
  });

  // ---- error branches: a null/undefined/invalid date must resolve deterministically with no
  // NaN-driven crash. null & undefined are the documented "no due date" path; an Invalid Date
  // object is truthy, so it slips the `!targetDate` guard and (NaN comparisons all false) falls
  // through to `later` — pinned here as the current, crash-free behavior.
  it("buckets an explicitly undefined due date as no_date", () => {
    expect(dueBucketFor(undefined as unknown as Date | null, now)).toBe("no_date");
  });

  it("does not crash on an Invalid Date and resolves deterministically", () => {
    const invalid = new Date("not-a-real-date");
    expect(Number.isNaN(invalid.getTime())).toBe(true);
    expect(() => dueBucketFor(invalid, now)).not.toThrow();
    expect(dueBucketFor(invalid, now)).toBe("later"); // NaN days ⇒ all bounds false ⇒ falls through
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

// The process-local per-repo scan claim (org-import-scan-watchlist #1): the manual scan + import paths
// had no equivalent of the cron's claimRescan lease, so two concurrent runs would double-scan + double-
// charge the same repo. claimRepoScan is the dedup guard — an atomic, TTL-leased advisory lock. Unique
// repo keys per test keep these hermetic against the module-global claim map (no shared reset needed).
describe("claimRepoScan / releaseRepoScan", () => {
  it("refuses a second concurrent claim for the same repo (the overlapping run must skip)", () => {
    const first = claimRepoScan("acme", "acme/repo");
    expect(first).not.toBeNull(); // the first run wins the claim
    expect(claimRepoScan("acme", "acme/repo")).toBeNull(); // a concurrent run is refused → it skips, never scans/charges
    // A different repo, or the same repo under a different org, is independent (per-(org,repo) key).
    const other = claimRepoScan("acme", "acme/other");
    const otherOrg = claimRepoScan("beta", "acme/repo");
    expect(other).not.toBeNull();
    expect(otherOrg).not.toBeNull();
    releaseRepoScan("acme", "acme/repo", first!);
    releaseRepoScan("acme", "acme/other", other!);
    releaseRepoScan("beta", "acme/repo", otherOrg!);
  });

  it("lets a RELEASED claim be re-taken (a completed run frees the repo)", () => {
    const first = claimRepoScan("acme", "acme/reuse");
    expect(first).not.toBeNull();
    releaseRepoScan("acme", "acme/reuse", first!);
    const second = claimRepoScan("acme", "acme/reuse"); // free again once the owner released
    expect(second).not.toBeNull();
    releaseRepoScan("acme", "acme/reuse", second!);
  });

  it("treats org + repo case-insensitively (same logical repo can't be double-claimed by casing)", () => {
    const t = claimRepoScan("Acme", "Acme/Repo");
    expect(t).not.toBeNull();
    expect(claimRepoScan("acme", "acme/repo")).toBeNull(); // same key despite casing → refused
    releaseRepoScan("ACME", "ACME/REPO", t!);
    const after = claimRepoScan("acme", "acme/repo"); // release is case-insensitive too → now free
    expect(after).not.toBeNull();
    releaseRepoScan("acme", "acme/repo", after!);
  });

  it("SELF-HEALS a crashed (never-released) claim after its TTL — a repo is never locked out forever", () => {
    vi.useFakeTimers();
    try {
      const token = claimRepoScan("acme", "acme/crashed", 1000);
      expect(token).not.toBeNull();
      expect(claimRepoScan("acme", "acme/crashed", 1000)).toBeNull(); // blocked while the lease is live
      vi.advanceTimersByTime(1001); // the owning process died — the lease elapses with no release
      const reclaimed = claimRepoScan("acme", "acme/crashed", 1000); // a later run recovers the repo
      expect(reclaimed).not.toBeNull();
      releaseRepoScan("acme", "acme/crashed", reclaimed!);
    } finally {
      vi.useRealTimers();
    }
  });

  it("release ignores a STALE token — a late owner can't clobber the run that reclaimed after expiry", () => {
    vi.useFakeTimers();
    try {
      const stale = claimRepoScan("acme", "acme/fence", 1000)!;
      vi.advanceTimersByTime(1001); // stale owner's lease expired without a release
      const fresh = claimRepoScan("acme", "acme/fence", 1000); // a new run reclaims the repo
      expect(fresh).not.toBeNull();
      releaseRepoScan("acme", "acme/fence", stale); // the stale owner wakes late and tries to release
      expect(claimRepoScan("acme", "acme/fence", 1000)).toBeNull(); // must be a no-op — fresh still owns it
      releaseRepoScan("acme", "acme/fence", fresh!);
    } finally {
      vi.useRealTimers();
    }
  });
});
