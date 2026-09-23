// The fleet Pareto reads the ONE judgment model (card ai-native-passports#A, challenge-2026-09-23).
//
// Before this, `aggregateBlockers` took no decisions: only an owner's overlay decline moved a repo out
// of the open population. A member who DISMISSED a blocker from the drawer (an OrgDecision) was still
// counted open, and the issue draft — which targets `repos` — filed a GitHub issue against a team that
// had already decided the gap: the "present a team's own decision back to them" failure the
// aggregation's header says it exists to prevent. Decided repos are now their own population,
// counted BESIDE the open one (never subtracted from the bucket's true size).

import { describe, it, expect } from "vitest";
import type { DecisionMap } from "@/lib/org/decision-map";
import { aggregateBlockers, type BlockerAggRow } from "@/features/standing/passports/passportBlockerAgg";

const CI = { id: "prod.ci-not-gating", code: "ci-not-gating", text: "CI does not gate merges.", severity: "block" as const };

const row = (name: string, over: Partial<BlockerAggRow["detail"]> = {}): BlockerAggRow => ({
  name,
  fullName: `acme/${name}`,
  detail: { autoBlockers: [], prodBlockers: [], ...over },
});

const open = (name: string) => row(name, { prodBlockers: [CI.text], prodFindings: [CI] });

const names = (rs: { name: string }[]) => rs.map((r) => r.name);

describe("aggregateBlockers(rows, decisions) — a member's decision is a decision", () => {
  it("moves a repo whose team DISMISSED the blocker out of `repos` and into `dismissedRepos`; the ranking total is unchanged", () => {
    const rows = [open("a"), open("b"), open("c")];
    const before = aggregateBlockers(rows)[0]!;
    const decisions: DecisionMap = { "acme/b::prod.ci-not-gating": { status: "dismissed", rationale: "docs mirror", decidedBy: "bob" } };
    const after = aggregateBlockers(rows, decisions)[0]!;

    expect(names(after.repos)).toEqual(["a", "c"]);
    expect(names(after.dismissedRepos)).toEqual(["b"]);
    const total = (a: typeof after) => a.repos.length + a.declinedRepos.length + a.dismissedRepos.length;
    expect(total(after)).toBe(total(before));
  });

  it("an EXPIRED snooze (decisionMap collapsed it to 'open') is open: counted in repos, targeted by the draft", () => {
    const decisions: DecisionMap = { "acme/b::prod.ci-not-gating": { status: "open", rationale: "later", decidedBy: "bob" } };
    const out = aggregateBlockers([open("a"), open("b")], decisions)[0]!;
    expect(names(out.repos)).toEqual(["a", "b"]);
    expect(out.dismissedRepos).toEqual([]);
  });

  it("guard: no decisions and no declines -> buckets, counts and order identical to the decision-free call", () => {
    const rows = [
      open("a"),
      open("b"),
      row("c", { autoBlockers: ["Agent can't self-verify: missing test script(s)."] }),
    ];
    const plain = aggregateBlockers(rows);
    const withEmpty = aggregateBlockers(rows, {});
    expect(withEmpty).toEqual(plain);
    expect(plain.every((a) => a.dismissedRepos.length === 0)).toBe(true);
  });

  it("guard: a re-surfaced overlay decline is not double-counted — it sits in repos, not declinedRepos, even with an OrgDecision beside it", () => {
    const decisions: DecisionMap = { "acme/a::prod.ci-not-gating": { status: "dismissed", rationale: "n/a", decidedBy: "bob" } };
    const out = aggregateBlockers(
      [
        row("a", {
          prodBlockers: [CI.text],
          prodFindings: [CI],
          declined: [{ path: "productionReadiness.ci", label: "CI merge gating", findingId: CI.id, needsReconfirm: true }],
        }),
      ],
      decisions,
    )[0]!;
    expect(names(out.repos)).toEqual(["a"]);
    expect(out.declinedRepos).toEqual([]);
    expect(out.dismissedRepos).toEqual([]);
  });

  it("guard: a pre-0.4.0 row with no findings is judged on the legacy prose key", async () => {
    const { blockerKey } = await import("@/lib/org/findings");
    const text = "No CI pipeline";
    const decisions: DecisionMap = { [blockerKey("acme/b", text)]: { status: "dismissed", rationale: "n/a", decidedBy: "bob" } };
    const out = aggregateBlockers([row("a", { prodBlockers: [text] }), row("b", { prodBlockers: [text] })], decisions)[0]!;
    expect(names(out.repos)).toEqual(["a"]);
    expect(names(out.dismissedRepos)).toEqual(["b"]);
  });

  it("guard: a coverage hole gets no bucket even when decided", () => {
    const hole = { id: "prod.ci-unassessable", code: "ci-unassessable", text: "CI gates could not be assessed.", severity: "info" as const };
    const decisions: DecisionMap = { "acme/a::prod.ci-unassessable": { status: "dismissed", rationale: "n/a", decidedBy: "bob" } };
    expect(aggregateBlockers([row("a", { prodBlockers: [hole.text], prodFindings: [hole] })], decisions)).toEqual([]);
  });
});
