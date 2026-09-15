// The ship-loop's cumulative impact — and the one rule that makes it honest: the sum of nothing is
// NULL, not 0.
//
// `opsImpact` reduces the verified landed PRs into the loop's headline number. Reducing an empty set
// gives 0, and a 0 in that slot is a verdict — "the loop shipped no measurable movement" — for a wall
// whose real state is "nothing has been rescanned yet, so nothing has been measured". Same defect as
// the mean of nothing (docs/features/org-dashboard/org-intelligence.md). The absence has to survive
// the reduce; only the render decides how to draw it.

import { describe, expect, it } from "vitest";
import { opsImpact } from "@/features/inflight/live/liveWarRoomOpsShared";
import type { OpsPrItem } from "@/lib/db";

const pr = (o: Partial<OpsPrItem>): OpsPrItem =>
  ({
    id: "p1",
    repoFullName: "acme/api",
    repoName: "api",
    dimId: "D1",
    practiceLabel: "seed",
    prNumber: 1,
    prUrl: "https://example.test/1",
    state: "merged",
    openedAt: "2026-06-01T00:00:00.000Z",
    mergedAt: "2026-06-02T00:00:00.000Z",
    verified: false,
    impactDim: null,
    impactOverall: null,
    ...o,
  }) as OpsPrItem;

describe("opsImpact — net movement is null until something is verified", () => {
  it("returns null net impact for an empty landed column", () => {
    expect(opsImpact([]).netOverall).toBeNull();
  });

  it("returns null while every landed PR is still awaiting its rescan", () => {
    const imp = opsImpact([pr({}), pr({ id: "p2" })]);
    expect(imp.netOverall).toBeNull();
    expect(imp.awaiting).toBe(2);
    expect(imp.verified).toBe(0);
  });

  it("reports a genuine zero once a rescan measured no movement — that IS a measurement", () => {
    const imp = opsImpact([pr({ verified: true, impactOverall: 0, impactDim: 0 })]);
    expect(imp.netOverall).toBe(0);
    expect(imp.verified).toBe(1);
    expect(imp.dimsLifted).toBe(0);
  });

  it("sums the verified rows and counts only the dimensions that actually rose", () => {
    const imp = opsImpact([
      pr({ verified: true, impactOverall: 4, impactDim: 6 }),
      pr({ id: "p2", verified: true, impactOverall: -1, impactDim: 0 }),
      pr({ id: "p3", verified: false, impactOverall: 99 }),
    ]);
    expect(imp.netOverall).toBe(3);
    expect(imp.dimsLifted).toBe(1);
  });
});
