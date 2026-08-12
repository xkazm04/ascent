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

// ── W2: trailer-based attribution (the third detection channel) ───────────────
//
// A squash-merged Claude Code PR whose author never wrote "🤖" in the description still carries
// `Co-Authored-By: Claude` in the squash commit — the channel AI_MARKER structurally missed. One
// shared predicate powers the rate AND the evidence rows, so both must agree in every case below.

const TRAILER = "feat: thing\n\nCo-Authored-By: Claude <noreply@anthropic.com>";

describe("summarizePullRequests / extractAiChanges — trailer attribution (W2)", () => {
  it("detects a trailer in the MERGE commit (squash-merge, the dominant case)", () => {
    const nodes = [pr({ number: 1, mergeCommit: { message: TRAILER } })];
    const stats = summarizePullRequests(nodes, 1);
    const rows = extractAiChanges(nodes);
    expect(stats.aiInvolvedRate).toBe(100);
    expect(stats.aiTrailerPrs).toBe(1);
    expect(rows[0]).toMatchObject({ aiSignal: "trailer" });
    expect(rows[0]!.aiTools).toContain("Claude"); // tool attribution sees the commit text
  });

  it("detects a trailer in the PR's own commits (rebase-merge — no merge commit survives)", () => {
    const nodes = [pr({ number: 2, mergeCommit: null, commits: { nodes: [{ commit: { message: "chore: wip" } }, { commit: { message: TRAILER } }] } })];
    expect(summarizePullRequests(nodes, 1).aiTrailerPrs).toBe(1);
    expect(extractAiChanges(nodes)[0]!.aiSignal).toBe("trailer");
  });

  it("recognizes the Assisted-By trailer phrase (shared vocabulary with the commit-level detector)", () => {
    const nodes = [pr({ number: 3, mergeCommit: { message: "feat: x\n\nAssisted-By: Copilot" } })];
    expect(summarizePullRequests(nodes, 1).aiTrailerPrs).toBe(1);
    expect(extractAiChanges(nodes)[0]!.aiTools).toContain("Copilot");
  });

  it("an UNMERGED PR's trailer commits do not attribute it (trailer is a merged-PR channel)", () => {
    const nodes = [pr({ number: 4, state: "OPEN", mergedAt: null, commits: { nodes: [{ commit: { message: TRAILER } }] } })];
    expect(summarizePullRequests(nodes, 1).aiInvolvedRate).toBe(0);
    expect(extractAiChanges(nodes)).toHaveLength(0);
  });

  it("precedence: a marked PR that ALSO carries a trailer stays 'marked' — but the trailer still grounds aiTrailerRate", () => {
    const merged = (n: number, over: Partial<PrNode> = {}) => pr({ number: n, ...over });
    const nodes = [
      merged(1, { title: "feat: parser 🤖 Generated with Claude Code", mergeCommit: { message: TRAILER } }), // marked + trailer
      merged(2, { mergeCommit: { message: TRAILER } }), // trailer only
      merged(3), merged(4), merged(5), // plain merged PRs (past the >=5 floor)
    ];
    const stats = summarizePullRequests(nodes, 5);
    const rows = extractAiChanges(nodes);
    expect(rows.map((r) => r.aiSignal)).toEqual(["marked", "trailer"]);
    expect(stats.aiMarkedPrs).toBe(1);
    expect(stats.aiTrailerPrs).toBe(1); // channel counts sum to the involved population
    expect(stats.aiTrailerRate).toBe(40); // 2 of 5 merged carry a trailer — precedence-independent
  });

  it("aiTrailerRate honours the >=5 MERGED floor — null below it, never a fabricated 0", () => {
    const nodes = [pr({ number: 1, mergeCommit: { message: TRAILER } }), pr({ number: 2 }), pr({ number: 3 }), pr({ number: 4 })];
    expect(summarizePullRequests(nodes, 4).aiTrailerRate).toBeNull(); // 4 merged < 5
    expect(summarizePullRequests([], 0).aiTrailerRate).toBeNull();
  });

  it("a node without the W2 fields (legacy fixture / partial page) is simply not trailer-attributed", () => {
    expect(summarizePullRequests([pr({ number: 1 })], 1).aiTrailerPrs).toBe(0);
  });
});

// ── W2: AI pre-review (review-capacity signal) ────────────────────────────────

describe("summarizePullRequests — aiPreReviewedRate (W2)", () => {
  const review = (state: string, login: string | null, submittedAt: string | null, typename = "User") => ({
    state,
    submittedAt,
    author: login ? { login, __typename: typename } : null,
  });
  const merged = (n: number, reviews: ReturnType<typeof review>[] = []) =>
    pr({ number: n, reviews: { totalCount: reviews.length, nodes: reviews } });

  it("counts a merged PR whose AI reviewer submitted BEFORE the first human review", () => {
    const nodes = [
      merged(1, [review("COMMENTED", "coderabbitai[bot]", "2026-01-01T01:00:00Z", "Bot"), review("APPROVED", "alice", "2026-01-01T02:00:00Z")]),
      merged(2, [review("APPROVED", "alice", "2026-01-01T01:00:00Z"), review("COMMENTED", "coderabbitai[bot]", "2026-01-01T02:00:00Z", "Bot")]), // human first
      merged(3, [review("COMMENTED", "copilot-pull-request-reviewer[bot]", "2026-01-01T01:00:00Z", "Bot")]), // AI only, no human at all
      merged(4),
      merged(5),
    ];
    // PRs 1 and 3 are pre-reviewed; 2 (human first), 4/5 (no reviews) are not.
    expect(summarizePullRequests(nodes, 5).aiPreReviewedRate).toBe(40);
  });

  it("a Bot-typed AI-agent reviewer (copilot[bot]) counts; a deleted account reads as human", () => {
    const nodes = [
      merged(1, [review("COMMENTED", "copilot[bot]", "2026-01-01T01:00:00Z", "Bot"), review("APPROVED", "alice", "2026-01-01T02:00:00Z")]),
      merged(2, [review("APPROVED", null, "2026-01-01T01:00:00Z"), review("COMMENTED", "greptile-apps[bot]", "2026-01-01T02:00:00Z", "Bot")]), // deleted human first
      merged(3),
      merged(4),
      merged(5),
    ];
    expect(summarizePullRequests(nodes, 5).aiPreReviewedRate).toBe(20); // only PR 1
  });

  it("ignores PENDING reviews (null submittedAt) — an unsubmitted review pre-reviewed nothing", () => {
    const nodes = [
      merged(1, [review("COMMENTED", "coderabbitai[bot]", null, "Bot"), review("APPROVED", "alice", "2026-01-01T02:00:00Z")]),
      merged(2), merged(3), merged(4), merged(5),
    ];
    expect(summarizePullRequests(nodes, 5).aiPreReviewedRate).toBe(0); // measured 0, not null — floor is met
  });

  it("honours the >=5 MERGED floor — null below it", () => {
    const nodes = [merged(1, [review("COMMENTED", "coderabbitai[bot]", "2026-01-01T01:00:00Z", "Bot")])];
    expect(summarizePullRequests(nodes, 1).aiPreReviewedRate).toBeNull();
  });

  it("a review-bot review does NOT flag the PR as AI-involved (reviewers are not authors)", () => {
    const nodes = [merged(1, [review("APPROVED", "coderabbitai[bot]", "2026-01-01T01:00:00Z", "Bot")])];
    expect(summarizePullRequests(nodes, 1).aiInvolvedRate).toBe(0);
    expect(extractAiChanges(nodes)).toHaveLength(0);
  });
});
