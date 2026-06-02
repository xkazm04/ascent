// Regression tests for the PR-velocity NaN guards (scan-and-decide idea 3b3cec72): a single
// malformed GitHub timestamp must not poison the velocity medians with NaN (which JSON.stringify
// would serialize as null and any downstream arithmetic would break on).

import { describe, it, expect } from "vitest";
import { summarizePullRequests } from "./pulls";
import type { PrNode } from "@/lib/github/graphql";

function pr(over: Partial<PrNode> = {}): PrNode {
  return {
    number: 1,
    title: "feat: thing",
    bodyText: "",
    isDraft: false,
    state: "MERGED",
    createdAt: "2026-01-01T00:00:00Z",
    mergedAt: "2026-01-02T00:00:00Z",
    closedAt: null,
    additions: 10,
    deletions: 5,
    changedFiles: 2,
    author: { login: "alice", __typename: "User" },
    labels: { nodes: [] },
    reviews: { totalCount: 0, nodes: [] },
    comments: { totalCount: 0 },
    ...over,
  };
}

describe("summarizePullRequests — timestamp NaN guards (#3)", () => {
  it("never returns NaN for the merge-time median when a mergedAt is malformed", () => {
    const stats = summarizePullRequests([pr({ mergedAt: "not-a-date" })], 1);
    expect(Number.isNaN(stats.medianHoursToMerge as number)).toBe(false);
    expect(stats.medianHoursToMerge).toBeNull(); // the only sample was dropped → no median
  });

  it("computes the median from valid timestamps and ignores the malformed one", () => {
    const nodes = [
      pr({ number: 1, createdAt: "2026-01-01T00:00:00Z", mergedAt: "2026-01-01T10:00:00Z" }), // 10h
      pr({ number: 2, createdAt: "2026-01-01T00:00:00Z", mergedAt: "2026-01-01T20:00:00Z" }), // 20h
      pr({ number: 3, createdAt: "2026-01-01T00:00:00Z", mergedAt: "garbage" }), // dropped
    ];
    const stats = summarizePullRequests(nodes, 3);
    expect(stats.medianHoursToMerge).toBe(15); // median of [10, 20], not corrupted by NaN
  });

  it("guards first-review time parsing the same way", () => {
    const stats = summarizePullRequests(
      [pr({ reviews: { totalCount: 1, nodes: [{ state: "APPROVED", submittedAt: "bad-ts" }] } })],
      1,
    );
    expect(Number.isNaN(stats.medianHoursToFirstReview as number)).toBe(false);
    expect(stats.medianHoursToFirstReview).toBeNull();
  });

  it("still produces a finite first-review median for valid data", () => {
    const stats = summarizePullRequests(
      [
        pr({
          createdAt: "2026-01-01T00:00:00Z",
          reviews: { totalCount: 1, nodes: [{ state: "APPROVED", submittedAt: "2026-01-01T05:00:00Z" }] },
        }),
      ],
      1,
    );
    expect(stats.medianHoursToFirstReview).toBe(5);
  });
});
