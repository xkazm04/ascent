// Regression tests for the PR-velocity NaN guards (scan-and-decide idea 3b3cec72): a single
// malformed GitHub timestamp must not poison the velocity medians with NaN (which JSON.stringify
// would serialize as null and any downstream arithmetic would break on).
// Plus the reviewedRate no-sample conflation (biz-bug-scan-2026-06-11, maturity #3): a window
// whose merged PRs are ALL bot-authored has no measurable human review discipline — that must
// surface as null, not a fabricated "0% reviewed" that drags D6 and misinforms the LLM auditor.

import { describe, it, expect } from "vitest";
import { applyPrSignals, summarizePullRequests } from "./pulls";
import type { PrNode } from "@/lib/github/graphql";
import type { DimensionSignals, PrStats } from "@/lib/types";

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

const botMerged = (n: number) => pr({ number: n, author: { login: "renovate[bot]", __typename: "Bot" } });

describe("summarizePullRequests — reviewedRate no-sample (maturity #3)", () => {
  it("returns null when every merged PR is bot-authored (no human review sample)", () => {
    const stats = summarizePullRequests([botMerged(1), botMerged(2), botMerged(3)], 3);
    expect(stats.reviewedRate).toBeNull();
  });

  it("still measures the rate when human-authored PRs merged", () => {
    const reviewed = pr({
      number: 4,
      reviews: { totalCount: 1, nodes: [{ state: "APPROVED", submittedAt: "2026-01-01T02:00:00Z" }] },
    });
    const unreviewed = pr({ number: 5 });
    const stats = summarizePullRequests([reviewed, unreviewed, botMerged(6)], 3);
    expect(stats.reviewedRate).toBe(50); // 1 of 2 human-merged; the bot merge is excluded
  });

  it("returns null for an empty window", () => {
    expect(summarizePullRequests([], 0).reviewedRate).toBeNull();
  });
});

describe("applyPrSignals — D6 fold with a null reviewedRate (maturity #3)", () => {
  const d6 = (): DimensionSignals[] => [{ id: "D6", signalScore: 80, signals: [] }];
  const base: PrStats = {
    analyzed: 10,
    totalCount: 10,
    open: 0,
    merged: 10,
    closedUnmerged: 0,
    mergeRate: 100,
    reviewedRate: null,
    avgReviews: 0,
    avgComments: 0,
    medianHoursToMerge: 4,
    medianHoursToFirstReview: null,
    avgLineChanges: 60,
    avgChangedFiles: 3,
    smallPrRate: 70,
    botAuthoredRate: 100,
    aiInvolvedRate: 0,
    aiGovernedRate: null,
    revertRate: 0,
    draftRate: 0,
    tools: [],
  };

  it("renormalizes prRigor over the measurable terms instead of folding a fabricated 0%", () => {
    const [out] = applyPrSignals(d6(), base);
    // prRigor = 0.6*70 + 0.4*100 = 82 → D6 = round(0.65*80 + 0.35*82) ≈ 81 — NOT the
    // fabricated-0% penalty path (0.5*0 + 0.3*70 + 0.2*100 = 41 → D6 = 66).
    expect(out!.signalScore).toBe(81);
    expect(out!.signals[0]!.label).toBe("PR review coverage n/a (no human-merged PRs in window)");
  });

  it("keeps the weighted review term when the rate is measured", () => {
    const [out] = applyPrSignals(d6(), { ...base, reviewedRate: 90 });
    // prRigor = 0.5*90 + 0.3*70 + 0.2*100 = 86 → D6 = round(0.65*80 + 0.35*86) ≈ 82.
    expect(out!.signalScore).toBe(82);
    expect(out!.signals[0]!.label).toBe("PR review coverage 90%");
  });
});
