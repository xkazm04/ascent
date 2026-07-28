// Regression tests for the PR-velocity NaN guards (scan-and-decide idea 3b3cec72): a single
// malformed GitHub timestamp must not poison the velocity medians with NaN (which JSON.stringify
// would serialize as null and any downstream arithmetic would break on).
// Plus the reviewedRate no-sample conflation (biz-bug-scan-2026-06-11, maturity #3): a window
// whose merged PRs are ALL bot-authored has no measurable human review discipline — that must
// surface as null, not a fabricated "0% reviewed" that drags D6 and misinforms the LLM auditor.

import { describe, it, expect, vi } from "vitest";
import { applyGovernanceSignals, applyPrSignals, extractAiChanges, fetchPrStats, summarizePullRequests } from "./pulls";
import type { PrNode } from "@/lib/github/graphql";
import { fetchPullRequests } from "@/lib/github/graphql";
import type { DimensionSignals, Governance, PrStats } from "@/lib/types";

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

describe("applyPrSignals / applyGovernanceSignals — a failed detector's placeholder is never blended (G3-08)", () => {
  const failedD6 = (): DimensionSignals[] => [{ id: "D6", signalScore: 0, signals: [], failed: true }];
  const base: PrStats = {
    analyzed: 10,
    totalCount: 10,
    open: 0,
    merged: 10,
    closedUnmerged: 0,
    mergeRate: 100,
    reviewedRate: 90,
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
  const gov: Governance = {
    defaultBranch: "main",
    protected: true,
    requiresPullRequest: true,
    requiredApprovals: 1,
    requiresCodeOwnerReview: false,
    requiresStatusChecks: true,
    requiresSignatures: false,
    linearHistory: false,
    ruleCount: 2,
    readable: true,
  };

  it("applyPrSignals leaves a failed dimension's placeholder score and signals untouched", () => {
    const [out] = applyPrSignals(failedD6(), base);
    expect(out).toEqual(failedD6()[0]); // byte-identical: no blend, no fabricated evidence appended
  });

  it("applyGovernanceSignals leaves a failed dimension's placeholder score and signals untouched", () => {
    const [out] = applyGovernanceSignals(failedD6(), gov);
    expect(out).toEqual(failedD6()[0]);
  });

  it("a non-failed dimension is unaffected by the guard (sanity check)", () => {
    const healthy: DimensionSignals[] = [{ id: "D6", signalScore: 80, signals: [] }];
    const [out] = applyPrSignals(healthy, base);
    expect(out!.signalScore).not.toBe(80); // still blends normally
  });
});

// D9 (Supply Chain & Security) is now scored by the deterministic check battery
// (src/lib/security/checks.ts + its unit tests), NOT a pulls.ts post-processor. The old
// applySecurityPostureSignals (advisory-tier boost) was removed when the battery subsumed it.

// ── extractAiChanges: the evidence rows behind the AI rates ───────────────────
// summarizePullRequests reduces these same nodes to percentages and drops the PRs, so ascent could
// state "62% of AI PRs were approved" but could never produce the population an auditor samples. These
// pin the two properties that make the rows usable as evidence: they RECONCILE with the rate shown
// beside them (same detectors), and the approver is the reviewer who actually unblocked the merge.
describe("extractAiChanges — the AI-change population", () => {
  const review = (state: string, login: string | null, submittedAt: string | null) => ({
    state,
    submittedAt,
    author: login ? { login } : null,
  });

  it("selects exactly the PRs the AI rate counts — the row count reconciles with aiInvolvedRate", () => {
    // A governance artifact whose row count disagreed with its own percentage would be worse than no
    // artifact, so both readings must come from the same detectors.
    const nodes = [
      pr({ number: 1, title: "chore: bump deps", author: { login: "renovate[bot]", __typename: "Bot" } }), // a bot, but NOT an AI agent
      pr({ number: 2, title: "feat: parser\n\n🤖 Generated with Claude Code" }), // human, AI-marked
      pr({ number: 3, title: "fix: typo" }), // no AI signal at all
      pr({ number: 4, title: "feat: agent work", author: { login: "copilot-swe-agent[bot]", __typename: "Bot" } }),
    ];
    const rows = extractAiChanges(nodes);
    const stats = summarizePullRequests(nodes, nodes.length);

    expect(rows.map((r) => r.prNumber)).toEqual([2, 4]);
    expect(stats.aiInvolvedRate).toBe(50); // 2 of 4 — the same two
    // The two signals carry different governance weight and are the first thing asked of a sampled row.
    expect(rows.map((r) => r.aiSignal)).toEqual(["marked", "authored"]);
    expect(rows[0]!.aiTools).toContain("Claude");
  });

  it("names the FIRST approver by submission time — the reviewer who unblocked the merge", () => {
    const rows = extractAiChanges([
      pr({
        number: 7,
        title: "feat: thing (github copilot)",
        reviews: {
          totalCount: 3,
          nodes: [
            review("COMMENTED", "carol", "2026-01-01T09:00:00Z"), // earlier, but not an approval
            review("APPROVED", "bob", "2026-01-01T12:00:00Z"),
            review("APPROVED", "dave", "2026-01-01T10:00:00Z"), // earliest APPROVAL — out of array order
          ],
        },
      }),
    ]);

    expect(rows[0]).toMatchObject({ approved: true, approverLogin: "dave", approvedAt: "2026-01-01T10:00:00Z", reviewCount: 3 });
  });

  it("records an UNAPPROVED AI change as the finding it is — reviewed is not approved", () => {
    // `approved:false` with a null approver is exactly what an auditor is hunting for, and it must be
    // distinguishable from "never reviewed at all" — hence reviewCount alongside the boolean.
    const [reviewedNotApproved, untouched] = extractAiChanges([
      pr({ number: 8, title: "claude code: refactor", reviews: { totalCount: 1, nodes: [review("CHANGES_REQUESTED", "bob", "2026-01-01T10:00:00Z")] } }),
      pr({ number: 9, title: "claude code: hotfix", reviews: { totalCount: 0, nodes: [] } }),
    ]);

    expect(reviewedNotApproved).toMatchObject({ approved: false, approverLogin: null, approvedAt: null, reviewCount: 1 });
    expect(untouched).toMatchObject({ approved: false, reviewCount: 0 });
  });

  it("keeps `approved` true when the approver's account was deleted (a real case, not an error)", () => {
    // GitHub nulls `author` on a deleted account. The approval still happened, so the control passed —
    // which is why the boolean and the name are separate fields rather than one nullable name.
    const rows = extractAiChanges([
      pr({ number: 10, title: "made with cursor", reviews: { totalCount: 1, nodes: [review("APPROVED", null, "2026-01-01T10:00:00Z")] } }),
    ]);
    expect(rows[0]).toMatchObject({ approved: true, approverLogin: null });
  });

  it("never picks a PENDING review (null submittedAt) as the approval ahead of a real one", () => {
    const rows = extractAiChanges([
      pr({
        number: 11,
        title: "claude code: thing",
        reviews: { totalCount: 2, nodes: [review("APPROVED", "pending-person", null), review("APPROVED", "bob", "2026-01-02T00:00:00Z")] },
      }),
    ]);
    expect(rows[0]!.approverLogin).toBe("bob");
  });
});
