// THE MIXED BATCH — the brief a green repository's lane has actually been getting since the green
// reservation landed, and which for a month was handed the ALL-GAP text.
//
// The defect, measured over 33 runs (docs/harness/reflection-2026-09-01.md, finding 1): `craftMode`
// asked `items.every(kind === "craft")`, 26 of 29 campaign-5 batches were mixed (two gaps plus five
// rungs, by design), so every one of them read "prefer the smallest change that closes the gap" and
// `STRUCTURAL_INVITATION` — the permission to restructure, shipped 2026-08-31 — reached no agent at
// all. Meanwhile 23 of 23 closes in those runs were craft rungs.
//
// These tests pin the delivery rule (the invitation follows the RUNG, not the batch's purity), the
// two deleted sentences, and that every honesty rule survived the edit.

import { describe, expect, it } from "vitest";
import { buildFixPrompt, type FollowUpItem } from "./followups";

const ctx = { org: "acme", generatedAt: "2026-09-01", commitPolicy: "lane" as const };

const gap = (over: Partial<FollowUpItem> = {}): FollowUpItem => ({
  id: "rec-gap",
  repo: "acme/widget",
  title: "Nine actions are pinned to floating tags",
  dimId: "D9",
  dimLabel: "Security",
  impact: "high",
  effort: "low",
  rationale: "A moved tag ships unreviewed code.",
  explore: ["Which workflows run on pull_request_target?"],
  projectedPoints: 4,
  kind: "gap",
  ...over,
});

const rung = (over: Partial<FollowUpItem> = {}): FollowUpItem => ({
  ...gap(),
  id: "rec-craft",
  title: "A performance budget that fails CI",
  dimId: "D2",
  dimLabel: "Testing & Verification",
  projectedPoints: null,
  kind: "craft",
  craftAxis: "performance",
  ...over,
});

const INVITATION = "LARGER CHANGES ARE INVITED, NOT MERELY TOLERATED";

describe("buildFixPrompt — a batch that holds both kinds", () => {
  it("DELIVERS the structural invitation to a mixed batch — the case the old `every` never matched", () => {
    const p = buildFixPrompt([gap(), rung()], ctx);
    expect(p).toContain(INVITATION);
    expect(p).toContain("MAY span many files");
    expect(p).toContain("MAY delete code");
  });

  it("delivers it to an all-craft batch too, unchanged", () => {
    expect(buildFixPrompt([rung()], ctx)).toContain(INVITATION);
  });

  it("does NOT deliver it to an all-gap batch — that brief keeps its own narrower sentence", () => {
    const p = buildFixPrompt([gap()], ctx);
    expect(p).not.toContain(INVITATION);
    expect(p).toContain("A LARGER CHANGE IS ALLOWED WHEN THE GAP'S REAL CAUSE IS STRUCTURAL");
    expect(p).toContain("Prefer the smallest change that closes the gap");
  });

  it("says which items are gaps and which are rungs, per item and up front", () => {
    const p = buildFixPrompt([gap(), rung()], ctx);
    expect(p).toContain("THIS BATCH HOLDS BOTH KINDS OF WORK");
    expect(p).toContain("RAISE THE CEILING");
    expect(p).toContain("`rec-gap` · **gap**");
    expect(p).toContain("`rec-craft` · **rung**");
    // The gap items keep their own instruction, scoped so it cannot be read over the rungs.
    expect(p).toContain("For the GAP items: prefer the smallest change");
    // …and a single-kind batch is not annotated at all: nothing to disambiguate.
    expect(buildFixPrompt([gap()], ctx)).not.toContain("**gap**");
  });

  it("carries the craft rules onto a mixed batch, minus the two sentences that selected for gates", () => {
    const p = buildFixPrompt([gap(), rung()], ctx);
    expect(p).toContain("Leave an ARTEFACT");
    expect(p).toContain("THE BAR IS THE CODE ITSELF");
    expect(p).toContain("well-structured, de-duplicated, faster");
    expect(p).toContain("DISCARDS a regression");
    // The deleted lines, in every batch shape.
    for (const items of [[rung()], [gap(), rung()], [gap()]]) {
      const brief = buildFixPrompt(items, ctx);
      expect(brief).not.toContain("one rung, not a redesign");
      expect(brief).not.toContain("Prefer something that RUNS");
      expect(brief).not.toContain("Keep it small and reversible");
    }
  });

  it("keeps every honesty rule intact on a mixed batch", () => {
    const p = buildFixPrompt([gap(), rung()], ctx);
    // The capability rule, verbatim anchors — the lane's only defence against a substitution.
    expect(p).toContain("WHAT THIS SESSION CANNOT DO");
    expect(p).toContain("You have NO shell and NO network");
    expect(p).toContain("Do NOT substitute an adjacent artefact and call the item RESOLVED");
    expect(p).toContain("RESOLVED means the gap THIS item names is closed by THIS change");
    // …and the claim's precedence is restated where the invitation could be misread as loosening it.
    expect(p).toContain("On a GAP item this changes nothing about the CLAIM");
    // The lane parser's contract.
    expect(p).toContain("RESOLVED: <id> - <what changed>");
    expect(p).toContain("Do not lower any existing bar");
  });

  it("still frames an ALL-craft batch as 'nothing is owed' and a mixed one as follow-ups", () => {
    expect(buildFixPrompt([rung()], ctx)).toContain("# Ascent craft ladder");
    const mixed = buildFixPrompt([gap(), rung()], ctx);
    expect(mixed).toContain("# Ascent follow-ups");
    // The "already green" claim is about the REPOSITORY, so it is only made when nothing is owed.
    expect(mixed).not.toContain("already green");
    expect(mixed).not.toContain("no open gaps left");
  });
});
