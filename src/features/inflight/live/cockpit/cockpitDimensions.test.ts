// The inspector's fleet arithmetic. The denominator is the thing worth pinning: "D2 open in 7 of 12"
// counts the SELECTED repos that have a proposal, not the whole fleet — over the fleet every share
// would quietly deflate and no dimension would ever read as an org-wide call.

import { describe, expect, it } from "vitest";
import { isOrgWide, proposalDimensions, shareLine, sharedDimensions } from "./cockpitDimensions";
import type { FollowUpItem, LoopProposal } from "./loopTypes";

const item = (id: string, dimId: string, points = 3): FollowUpItem => ({
  id,
  repo: "acme/x",
  title: `fix ${id}`,
  dimId,
  dimLabel: dimId === "D2" ? "Testing" : "CI/CD",
  impact: "high",
  effort: "low",
  rationale: "",
  explore: [],
  projectedPoints: points,
});

const proposal = (repo: string, items: FollowUpItem[]): LoopProposal => ({
  repo,
  items,
  projectedPoints: items.reduce((n, i) => n + (i.projectedPoints ?? 0), 0),
});

describe("sharedDimensions", () => {
  it("counts a repo ONCE per dimension however many items it has there", () => {
    const proposals = [proposal("a/one", [item("1", "D2"), item("2", "D2"), item("3", "D3")])];
    const { rows, total } = sharedDimensions(proposals, new Set(["a/one"]));
    expect(total).toBe(1);
    expect(rows.find((r) => r.dimId === "D2")).toMatchObject({ repos: 1, items: 2, points: 6 });
    expect(rows.find((r) => r.dimId === "D3")).toMatchObject({ repos: 1, items: 1 });
  });

  it("ignores proposals for repos that are not selected", () => {
    const proposals = [proposal("a/one", [item("1", "D2")]), proposal("a/two", [item("2", "D2")])];
    const { rows, total } = sharedDimensions(proposals, new Set(["a/one"]));
    expect(total).toBe(1);
    expect(rows[0]).toMatchObject({ dimId: "D2", repos: 1, share: 1 });
  });

  it("orders widest-first, breaking ties on points then id", () => {
    const proposals = [
      proposal("a/one", [item("1", "D3"), item("2", "D2")]),
      proposal("a/two", [item("3", "D2")]),
      proposal("a/three", [item("4", "D2")]),
    ];
    const { rows } = sharedDimensions(proposals, new Set(["a/one", "a/two", "a/three"]));
    expect(rows.map((r) => r.dimId)).toEqual(["D2", "D3"]);
    expect(rows[0]!.share).toBeCloseTo(1);
    expect(rows[1]!.share).toBeCloseTo(1 / 3);
  });

  it("returns nothing at all for an empty selection (no division by zero)", () => {
    expect(sharedDimensions([proposal("a/one", [item("1", "D2")])], new Set())).toEqual({ total: 0, rows: [] });
  });

  it("skips a selected repo whose proposal is empty, but still counts it in the denominator", () => {
    const proposals = [proposal("a/one", [item("1", "D2")]), proposal("a/two", [])];
    const { rows, total } = sharedDimensions(proposals, new Set(["a/one", "a/two"]));
    expect(total).toBe(2);
    expect(rows[0]).toMatchObject({ repos: 1, share: 0.5 });
  });
});

describe("isOrgWide", () => {
  const row = (repos: number) => ({ dimId: "D2", label: "Testing", repos, items: repos, points: 0, share: 0 });

  it("is true at half the selected repos or more", () => {
    expect(isOrgWide(row(6), 12)).toBe(true);
    expect(isOrgWide(row(7), 12)).toBe(true);
    expect(isOrgWide(row(5), 12)).toBe(false);
  });

  it("is never true for a selection of one — '1 of 1' is a tautology, not a finding", () => {
    expect(isOrgWide(row(1), 1)).toBe(false);
  });
});

describe("shareLine", () => {
  it("reads as the org-wide call it is", () => {
    expect(shareLine({ dimId: "D2", label: "Testing", repos: 7, items: 9, points: 0, share: 0 }, 12)).toBe("D2 open in 7 of 12");
  });
});

describe("proposalDimensions", () => {
  it("lists every dimension present, deduped and id-sorted", () => {
    const proposals = [proposal("a/one", [item("1", "D3"), item("2", "D2")]), proposal("a/two", [item("3", "D2")])];
    expect(proposalDimensions(proposals)).toEqual([
      { id: "D2", label: "Testing" },
      { id: "D3", label: "CI/CD" },
    ]);
  });
});
