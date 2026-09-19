// W5 revert linkage + rework rates: title-path and sha-path matching, the lower-bound semantics
// (cross-window targets escape without corrupting the denominator), the ≥5 sample floors (merged for
// reworkRate; merged AND AI-involved-merged for aiReworkRate), and the AiChange evidence stamping —
// which must come from the SAME linkage the summarizer computes, so a stamped row can never disagree
// with the rate shown beside it.

import { describe, expect, it } from "vitest";
import { extractAiChanges, linkReverts, summarizePullRequests } from "./pulls";
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

const FULL_SHA = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

describe("linkReverts — title path", () => {
  it("links a merged `Revert \"<title>\"` PR to the earlier merged PR with that exact title", () => {
    const target = pr({ number: 10, title: "feat: add dark mode", mergedAt: "2026-01-02T00:00:00Z" });
    const revert = pr({ number: 11, title: 'Revert "feat: add dark mode"', mergedAt: "2026-01-05T00:00:00Z" });
    const map = linkReverts([target, revert]);
    expect(map.get(10)).toEqual({ byPr: 11, at: "2026-01-05T00:00:00Z" });
    expect(map.has(11)).toBe(false); // the revert itself is not "reverted"
  });

  it("nested reverts link one level at a time (a revert-of-a-revert targets the inner revert)", () => {
    const original = pr({ number: 1, title: "feat: x", mergedAt: "2026-01-01T00:00:00Z" });
    const revert = pr({ number: 2, title: 'Revert "feat: x"', mergedAt: "2026-01-02T00:00:00Z" });
    const rerevert = pr({ number: 3, title: 'Revert "Revert "feat: x""', mergedAt: "2026-01-03T00:00:00Z" });
    const map = linkReverts([original, revert, rerevert]);
    expect(map.get(1)?.byPr).toBe(2);
    expect(map.get(2)?.byPr).toBe(3);
  });

  it("chronology guard: a same-titled PR merged AFTER the revert is not linked backwards", () => {
    const revert = pr({ number: 5, title: 'Revert "feat: y"', mergedAt: "2026-01-02T00:00:00Z" });
    const later = pr({ number: 6, title: "feat: y", mergedAt: "2026-01-09T00:00:00Z" }); // the re-land
    expect(linkReverts([revert, later]).size).toBe(0);
  });

  it("an UNMERGED revert PR reverts nothing", () => {
    const target = pr({ number: 1, title: "feat: z" });
    const openRevert = pr({ number: 2, title: 'Revert "feat: z"', state: "OPEN", mergedAt: null });
    expect(linkReverts([target, openRevert]).size).toBe(0);
  });

  it("a renamed revert escapes the matcher — the documented lower bound", () => {
    const target = pr({ number: 1, title: "feat: risky" });
    const renamed = pr({ number: 2, title: "back out the risky change", mergedAt: "2026-01-05T00:00:00Z" });
    expect(linkReverts([target, renamed]).size).toBe(0);
  });
});

describe("linkReverts — sha path", () => {
  it("links via `This reverts commit <sha>` in the revert's body against the target's merge-commit oid", () => {
    const target = pr({ number: 20, title: "feat: a", mergeCommit: { oid: FULL_SHA, message: "feat: a (#20)" } });
    const revert = pr({
      number: 21,
      title: "hotfix: back out", // NOT revert-titled — the sha path must carry it alone
      bodyText: `This reverts commit ${FULL_SHA}.`,
      mergedAt: "2026-01-06T00:00:00Z",
    });
    expect(linkReverts([target, revert]).get(20)).toEqual({ byPr: 21, at: "2026-01-06T00:00:00Z" });
  });

  it("matches abbreviated shas (prefix-tolerant both ways) and PR-commit oids", () => {
    const target = pr({
      number: 30,
      title: "feat: b",
      commits: { nodes: [{ commit: { oid: FULL_SHA, message: "feat: b" } }] },
    });
    const revert = pr({
      number: 31,
      title: "Revert broken change",
      mergeCommit: { message: `Revert broken change\n\nThis reverts commit ${FULL_SHA.slice(0, 10)}.` },
      mergedAt: "2026-01-07T00:00:00Z",
    });
    expect(linkReverts([target, revert]).get(30)?.byPr).toBe(31);
  });

  it("a cross-window revert (target's commits not in the page) matches nothing", () => {
    const revert = pr({
      number: 40,
      title: 'Revert "old change"',
      bodyText: `This reverts commit ${FULL_SHA}.`,
      mergedAt: "2026-01-06T00:00:00Z",
    });
    // The reverted PR merged before the window — only the revert is visible.
    expect(linkReverts([pr({ number: 41, title: "feat: unrelated" }), revert]).size).toBe(0);
  });

  it("earliest revert wins when two reverts hit the same target", () => {
    const target = pr({ number: 50, title: "feat: c", mergeCommit: { oid: FULL_SHA, message: "m" } });
    const late = pr({ number: 52, bodyText: `This reverts commit ${FULL_SHA}`, title: "revert again", mergedAt: "2026-01-09T00:00:00Z" });
    const early = pr({ number: 51, bodyText: `This reverts commit ${FULL_SHA}`, title: "revert once", mergedAt: "2026-01-03T00:00:00Z" });
    expect(linkReverts([target, late, early]).get(50)).toEqual({ byPr: 51, at: "2026-01-03T00:00:00Z" });
  });
});

// AI-involved merged PR (trailer channel) at number n, merged, whose title a revert can quote.
const aiMerged = (n: number, title: string) =>
  pr({
    number: n,
    title,
    mergedAt: `2026-01-0${(n % 8) + 1}T00:00:00Z`,
    mergeCommit: { message: `${title}\n\nCo-Authored-By: Claude <noreply@anthropic.com>` },
  });

describe("summarizePullRequests — reworkRate / aiReworkRate", () => {
  it("computes reworkRate over merged PRs and aiReworkRate over AI-involved merged PRs", () => {
    const nodes = [
      aiMerged(1, "feat: one"),
      aiMerged(2, "feat: two"),
      aiMerged(3, "feat: three"),
      aiMerged(4, "feat: four"),
      aiMerged(5, "feat: five"),
      pr({ number: 6, title: "chore: human", mergedAt: "2026-01-03T00:00:00Z" }),
      pr({ number: 7, title: 'Revert "feat: one"', mergedAt: "2026-01-09T00:00:00Z" }),
      pr({ number: 8, title: 'Revert "chore: human"', mergedAt: "2026-01-09T00:00:00Z" }),
    ];
    const stats = summarizePullRequests(nodes, 8);
    // 8 merged; targets #1 and #6 reverted → 2/8 = 25%.
    expect(stats.reworkRate).toBe(25);
    // AI-involved merged: #1–#5 (trailer) → 5; of those only #1 reverted → 1/5 = 20%.
    expect(stats.aiReworkRate).toBe(20);
  });

  it("a revert whose target is OUT of the window counts in revertRate but not reworkRate — lower bound", () => {
    const nodes = [
      aiMerged(1, "feat: one"),
      aiMerged(2, "feat: two"),
      aiMerged(3, "feat: three"),
      aiMerged(4, "feat: four"),
      pr({ number: 9, title: 'Revert "something ancient"', mergedAt: "2026-01-09T00:00:00Z" }),
    ];
    const stats = summarizePullRequests(nodes, 5);
    expect(stats.revertRate).toBeGreaterThan(0); // the title-regex rate still sees the revert
    expect(stats.reworkRate).toBe(0); // 5 merged, 0 matched targets — a measured (lower-bound) zero
  });

  it("honours the ≥5 MERGED floor — null below it, never a fabricated 0", () => {
    const nodes = [aiMerged(1, "a"), aiMerged(2, "b"), aiMerged(3, "c"), pr({ number: 4, title: 'Revert "a"', mergedAt: "2026-01-09T00:00:00Z" })];
    const stats = summarizePullRequests(nodes, 4);
    expect(stats.reworkRate).toBeNull();
    expect(stats.aiReworkRate).toBeNull();
    expect(summarizePullRequests([], 0).reworkRate).toBeNull();
  });

  it("aiReworkRate additionally floors on ≥5 AI-involved merged PRs (reworkRate can be measured while it is not)", () => {
    const nodes = [
      aiMerged(1, "feat: ai-one"),
      aiMerged(2, "feat: ai-two"),
      pr({ number: 3, title: "h1", mergedAt: "2026-01-02T00:00:00Z" }),
      pr({ number: 4, title: "h2", mergedAt: "2026-01-02T00:00:00Z" }),
      pr({ number: 5, title: "h3", mergedAt: "2026-01-02T00:00:00Z" }),
      pr({ number: 6, title: 'Revert "feat: ai-one"', mergedAt: "2026-01-09T00:00:00Z" }),
    ];
    const stats = summarizePullRequests(nodes, 6);
    expect(stats.reworkRate).toBe(17); // 1/6 merged — measurable
    expect(stats.aiReworkRate).toBeNull(); // only 2 AI-involved merged — below ITS floor
  });
});

describe("extractAiChanges — revert stamping", () => {
  it("stamps a reverted AI PR with the revert's number + merge time; unreverted rows carry nulls", () => {
    const nodes = [
      aiMerged(1, "feat: ai-one"),
      aiMerged(2, "feat: ai-two"),
      pr({ number: 3, title: 'Revert "feat: ai-one"', mergedAt: "2026-01-09T00:00:00Z" }),
    ];
    const rows = extractAiChanges(nodes);
    const one = rows.find((r) => r.prNumber === 1)!;
    expect(one.revertedByPr).toBe(3);
    expect(one.revertedAt).toBe("2026-01-09T00:00:00Z");
    const two = rows.find((r) => r.prNumber === 2)!;
    expect(two.revertedByPr).toBeNull();
    expect(two.revertedAt).toBeNull();
  });

  it("the stamped population reconciles with the summarizer's numerator (same linkage, two readings)", () => {
    const nodes = [
      aiMerged(1, "a"),
      aiMerged(2, "b"),
      aiMerged(3, "c"),
      aiMerged(4, "d"),
      aiMerged(5, "e"),
      pr({ number: 6, title: 'Revert "b"', mergedAt: "2026-01-09T00:00:00Z" }),
      pr({ number: 7, title: 'Revert "d"', mergedAt: "2026-01-09T00:00:00Z" }),
    ];
    const stats = summarizePullRequests(nodes, 7);
    const stamped = extractAiChanges(nodes).filter((r) => r.revertedByPr != null).length;
    // aiReworkRate = stamped / AI-involved merged (5) — the rate and the rows must agree.
    expect(stats.aiReworkRate).toBe(Math.round((stamped / 5) * 100));
    expect(stamped).toBe(2);
  });
});
