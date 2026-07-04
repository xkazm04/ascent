// Regression tests for the PR-velocity NaN guards (scan-and-decide idea 3b3cec72): a single
// malformed GitHub timestamp must not poison the velocity medians with NaN (which JSON.stringify
// would serialize as null and any downstream arithmetic would break on).
// Plus the reviewedRate no-sample conflation (biz-bug-scan-2026-06-11, maturity #3): a window
// whose merged PRs are ALL bot-authored has no measurable human review discipline — that must
// surface as null, not a fabricated "0% reviewed" that drags D6 and misinforms the LLM auditor.

import { describe, it, expect } from "vitest";
import { applyPrSignals, applySecurityPostureSignals, summarizePullRequests } from "./pulls";
import type { PrNode } from "@/lib/github/graphql";
import type { DimensionSignals, PrStats, SecurityPosture } from "@/lib/types";

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

// The D9 file detector is structurally blind to GitHub-managed security (code scanning / Dependabot
// configured in Settings, an active advisory program), so a mature repo like next.js scored ~0.
// applySecurityPostureSignals closes that blind spot additively — these lock in the tiers, the
// additive-only contract (absence never penalizes), and that only D9 is touched.
describe("applySecurityPostureSignals — GitHub-native security folds into D9", () => {
  const dims = (): DimensionSignals[] => [
    { id: "D6", signalScore: 70, signals: [] },
    { id: "D9", signalScore: 0, signals: [] }, // the next.js case: zero committed security-as-code
  ];
  const d9 = (out: DimensionSignals[]) => out.find((s) => s.id === "D9")!;
  const post = (over: Partial<SecurityPosture>): SecurityPosture => ({
    advisoryCount: 0,
    advisoryCapped: false,
    orgSecurityPolicy: false,
    ...over,
  });

  it("lifts a mature coordinated-disclosure program out of the critical band (the next.js fix)", () => {
    // 50 published advisories (capped floor) + org policy: +30 +8 = 38 — a fair 'weak' posture for a
    // repo whose security is GitHub-managed, not committed, instead of a false-negative 0.
    const out = applySecurityPostureSignals(dims(), post({ advisoryCount: 100, advisoryCapped: true, orgSecurityPolicy: true }));
    expect(d9(out).signalScore).toBe(38);
    expect(d9(out).signals.some((s) => /coordinated-disclosure program \(100\+/.test(s.label))).toBe(true);
    expect(d9(out).signals.some((s) => /Org-level security policy/.test(s.label))).toBe(true);
  });

  it("scales by advisory tier (>=20 / >=5 / >=1) and adds the policy boost independently", () => {
    expect(d9(applySecurityPostureSignals(dims(), post({ advisoryCount: 20 }))).signalScore).toBe(30);
    expect(d9(applySecurityPostureSignals(dims(), post({ advisoryCount: 5 }))).signalScore).toBe(22);
    expect(d9(applySecurityPostureSignals(dims(), post({ advisoryCount: 1 }))).signalScore).toBe(14);
    expect(d9(applySecurityPostureSignals(dims(), post({ orgSecurityPolicy: true }))).signalScore).toBe(8);
  });

  it("is additive-only: an empty posture (no advisories, no policy) leaves every score untouched", () => {
    const out = applySecurityPostureSignals(dims(), post({}));
    expect(d9(out).signalScore).toBe(0);
    expect(out.find((s) => s.id === "D6")!.signalScore).toBe(70);
  });

  it("touches ONLY D9 — a strong security posture never inflates another dimension", () => {
    const out = applySecurityPostureSignals(dims(), post({ advisoryCount: 40, orgSecurityPolicy: true }));
    expect(out.find((s) => s.id === "D6")!.signalScore).toBe(70);
    expect(out.find((s) => s.id === "D6")!.signals).toHaveLength(0);
  });

  it("null/undefined posture (tokenless scan) is a no-op", () => {
    expect(applySecurityPostureSignals(dims(), null)).toEqual(dims());
    expect(applySecurityPostureSignals(dims(), undefined)).toEqual(dims());
  });

  it("clamps so a huge advisory count plus a high base can't exceed 100", () => {
    const highBase: DimensionSignals[] = [{ id: "D9", signalScore: 90, signals: [] }];
    const out = applySecurityPostureSignals(highBase, post({ advisoryCount: 100, advisoryCapped: true, orgSecurityPolicy: true }));
    expect(d9(out).signalScore).toBe(100); // 90 + 38 clamped, not 128
  });
});
