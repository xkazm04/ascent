// Regression tests for the PR-velocity NaN guards (scan-and-decide idea 3b3cec72): a single
// malformed GitHub timestamp must not poison the velocity medians with NaN (which JSON.stringify
// would serialize as null and any downstream arithmetic would break on).
// Plus the reviewedRate no-sample conflation (biz-bug-scan-2026-06-11, maturity #3): a window
// whose merged PRs are ALL bot-authored has no measurable human review discipline — that must
// surface as null, not a fabricated "0% reviewed" that drags D6 and misinforms the LLM auditor.

import { describe, it, expect, vi } from "vitest";
import { applyPrSignals, fetchPrStats, summarizePullRequests } from "./pulls";
import type { PrNode } from "@/lib/github/graphql";
import { fetchPullRequests } from "@/lib/github/graphql";
import type { DimensionSignals, PrStats } from "@/lib/types";

// fetchPrStats reaches GitHub via fetchPullRequests; mock that so we can assert the `partial`
// flag round-trips out of fetchPrStats (github-repo-data-access #1) without a live GraphQL call.
vi.mock("@/lib/github/graphql", () => ({ fetchPullRequests: vi.fn() }));

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

  it("still measures the rate once the >=5 human-merged sample floor is met", () => {
    const reviewed = (n: number) =>
      pr({ number: n, reviews: { totalCount: 1, nodes: [{ state: "APPROVED", submittedAt: "2026-01-01T02:00:00Z" }] } });
    const nodes = [reviewed(1), reviewed(2), reviewed(3), reviewed(4), pr({ number: 5 }), botMerged(6)];
    const stats = summarizePullRequests(nodes, 6);
    expect(stats.reviewedRate).toBe(80); // 4 of 5 human-merged; the bot merge is excluded
  });

  // Minimum-sample floor (ambiguity-ui 2026-07-16 maturity #2) — the same >=5 floor as
  // aiGovernedRate. Pre-fix, a window with ONE self-merged human PR produced reviewedRate=0,
  // dragging D6 (prRigor weights review at 0.5) and potentially flipping the rigor axis/posture
  // off a statistically meaningless 1-PR sample.
  it("returns null (not a fabricated 0%) below 5 human-merged PRs — one self-merged PR can no longer drag D6", () => {
    expect(summarizePullRequests([pr({ number: 1 })], 1).reviewedRate).toBeNull(); // 1 unreviewed human merge
    const four = [pr({ number: 1 }), pr({ number: 2 }), pr({ number: 3 }), pr({ number: 4 })];
    expect(summarizePullRequests(four, 4).reviewedRate).toBeNull(); // still under the floor at 4
  });

  it("returns null for an empty window", () => {
    expect(summarizePullRequests([], 0).reviewedRate).toBeNull();
  });
});

describe("summarizePullRequests — null nodes from a partial page (github-repo-data-access #1)", () => {
  it("does not crash on null node slots and excludes them from `analyzed`", () => {
    // A partial GraphQL page leaves null slots for the PRs that failed to resolve. The summarizer
    // dereferences every node, so an unfiltered null used to NPE on `pr.state`.
    const stats = summarizePullRequests([pr({ number: 1 }), null, pr({ number: 2 })], 5);
    expect(stats.analyzed).toBe(2); // two real PRs summarized; the null slot dropped
    expect(stats.totalCount).toBe(5); // repo-wide count still honoured
  });

  it("handles an all-null page without throwing", () => {
    const stats = summarizePullRequests([null, null], 2);
    expect(stats.analyzed).toBe(0);
    expect(stats.reviewedRate).toBeNull();
  });
});

describe("fetchPrStats — partial flag propagation (github-repo-data-access #1)", () => {
  const mockFetch = vi.mocked(fetchPullRequests);

  it("surfaces partial:true when the underlying PR page was incomplete", async () => {
    mockFetch.mockResolvedValueOnce({ totalCount: 5, nodes: [pr()], partial: true });
    const res = await fetchPrStats("o", "r", "tok");
    expect(res.partial).toBe(true); // caller must annotate + skip caching as authoritative
    expect(res.stats.analyzed).toBe(1);
  });

  it("reports partial:false for a complete page (flag omitted upstream)", async () => {
    mockFetch.mockResolvedValueOnce({ totalCount: 1, nodes: [pr()] });
    const res = await fetchPrStats("o", "r", "tok");
    expect(res.partial).toBe(false);
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
    expect(out!.signals[0]!.label).toBe("PR review coverage n/a (fewer than 5 human-merged PRs in window)");
  });

  it("keeps the weighted review term when the rate is measured", () => {
    const [out] = applyPrSignals(d6(), { ...base, reviewedRate: 90 });
    // prRigor = 0.5*90 + 0.3*70 + 0.2*100 = 86 → D6 = round(0.65*80 + 0.35*86) ≈ 82.
    expect(out!.signalScore).toBe(82);
    expect(out!.signals[0]!.label).toBe("PR review coverage 90%");
  });
});

// D9 (Supply Chain & Security) is now scored by the deterministic check battery
// (src/lib/security/checks.ts + its unit tests), NOT a pulls.ts post-processor. The old
// applySecurityPostureSignals (advisory-tier boost) was removed when the battery subsumed it.
