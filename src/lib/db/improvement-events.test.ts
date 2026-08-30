// The union fold. Every case here is a way the ledger could over- or under-claim, and the fold is
// the single place each is settled — rather than at each of the three consumers, which is how two of
// them would eventually disagree.

import { describe, expect, it } from "vitest";
import {
  foldImprovementEvents,
  inReviewLanes,
  inReviewPoints,
  type EventPrInput,
  type LaneImpactInput,
} from "@/lib/db/improvement-events";

const pr = (over: Partial<EventPrInput> = {}): EventPrInput => ({
  repoFullName: "acme/web",
  label: "CI gate",
  dimId: "D3",
  dimPoints: 6,
  overall: 4,
  mergedAt: "2026-08-20T10:00:00.000Z",
  prNumber: 12,
  prUrl: "https://github.com/acme/web/pull/12",
  afterScanId: "scan-a",
  ...over,
});

const lane = (over: Partial<LaneImpactInput> = {}): LaneImpactInput => ({
  laneId: "lane-1",
  runId: "run-1",
  repoFullName: "acme/web",
  cycle: 1,
  dimId: "D6",
  dimPoints: 4,
  overall: 3,
  endedAt: "2026-08-22T10:00:00.000Z",
  beforeScanId: "b",
  afterScanId: "scan-l",
  prNumber: null,
  prUrl: null,
  commits: 2,
  ...over,
});

describe("foldImprovementEvents — the two bases", () => {
  it("tags a merged PR `merged` and a lane branch `branch`", () => {
    const events = foldImprovementEvents([pr()], [lane()]);
    expect(events.map((e) => [e.source, e.basis])).toEqual([
      ["loop", "branch"],
      ["practice-pr", "merged"],
    ]);
  });

  it("orders newest first", () => {
    const events = foldImprovementEvents([pr()], [lane()]);
    expect(events[0]!.at > events[1]!.at).toBe(true);
  });

  it("labels a lane with its cycle rather than borrowing a practice name", () => {
    expect(foldImprovementEvents([], [lane({ cycle: 3 })])[0]!.label).toBe("Loop lane · cycle 3");
  });
});

describe("foldImprovementEvents — dedupe", () => {
  it("drops a lane's branch row once its PR has merged — the same work, counted once", () => {
    const events = foldImprovementEvents([pr({ loopLaneId: "lane-1", afterScanId: "scan-m" })], [lane()]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: "loop", basis: "merged", laneId: "lane-1" });
  });

  it("drops a lane whose after-scan is the SAME scan the merged row measured", () => {
    const events = foldImprovementEvents([pr({ afterScanId: "scan-l" })], [lane()]);
    expect(events).toHaveLength(1);
    expect(events[0]!.basis).toBe("merged");
  });

  it("keeps a lane whose PR is open but not yet merged", () => {
    const events = foldImprovementEvents([], [lane({ prNumber: 9, prUrl: "u" })]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ basis: "branch", prNumber: 9 });
  });

  it("de-duplicates two PR rows measuring one scan", () => {
    expect(foldImprovementEvents([pr(), pr({ prNumber: 13 })], [])).toHaveLength(1);
  });
});

describe("foldImprovementEvents — honest nulls", () => {
  it("counts a one-ended lane as awaiting, never as zero", () => {
    const e = foldImprovementEvents([], [lane({ afterScanId: null })])[0]!;
    expect(e.verified).toBe(false);
    expect(e.dimPoints).toBeNull();
  });

  it("refuses a lane that committed nothing — it measured a worktree the run then deleted", () => {
    const e = foldImprovementEvents([], [lane({ commits: 0 })])[0]!;
    expect(e.dimPoints).toBeNull();
    expect(e.verified).toBe(false);
  });

  it("never coerces a null dimPoints to 0 on either side", () => {
    const events = foldImprovementEvents([pr({ dimPoints: null })], [lane({ dimPoints: null })]);
    expect(events.every((e) => e.dimPoints === null)).toBe(true);
    expect(events.every((e) => e.verified === false)).toBe(true);
  });

  it("keeps the SIGN — a regression is reported as one, not dropped", () => {
    expect(foldImprovementEvents([], [lane({ dimPoints: -5 })])[0]!.dimPoints).toBe(-5);
  });

  it("carries a lane with no dominant dimension, with dimId null so it joins no byDim bucket", () => {
    expect(foldImprovementEvents([], [lane({ dimId: null })])[0]!.dimId).toBeNull();
  });
});

describe("inReviewPoints — bought is bought", () => {
  it("counts branch-basis movement only, never the merged rows", () => {
    // The whole reason the two bases exist: a buyer's "bought" number must not include work sitting
    // on a branch nobody has reviewed.
    const events = foldImprovementEvents([pr({ dimPoints: 6 })], [lane({ dimPoints: 4 })]);
    expect(inReviewPoints(events)).toBe(4);
  });

  it("is NULL, not 0, when no lane is measurable", () => {
    expect(inReviewPoints(foldImprovementEvents([pr()], []))).toBeNull();
    expect(inReviewPoints(foldImprovementEvents([], [lane({ afterScanId: null })]))).toBeNull();
  });

  it("counts the lanes behind the number", () => {
    const events = foldImprovementEvents([], [lane(), lane({ laneId: "lane-2", afterScanId: "scan-l2" })]);
    expect(inReviewLanes(events)).toBe(2);
    expect(inReviewPoints(events)).toBe(8);
  });

  it("moves nothing when the lane's PR merged — the points are bought, not in review", () => {
    const events = foldImprovementEvents([pr({ loopLaneId: "lane-1", afterScanId: "scan-m" })], [lane()]);
    expect(inReviewPoints(events)).toBeNull();
  });
});

describe("overall is per row, never a total", () => {
  it("carries overall on each row and offers no sum of it", () => {
    const events = foldImprovementEvents([pr({ overall: 4 })], [lane({ overall: 3 })]);
    expect(events.map((e) => e.overall).sort()).toEqual([3, 4]);
    // There is deliberately no `overallTotal` export: overall scores are weighted per repo and their
    // sum is not a quantity anyone can act on.
    expect(Object.keys({ inReviewPoints, inReviewLanes, foldImprovementEvents })).not.toContain("overallTotal");
  });
});
