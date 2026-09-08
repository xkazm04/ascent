// The decay field's arithmetic and its honesty rules, pinned without a DOM.

import { describe, it, expect } from "vitest";
import { days, decayCurve, decayField } from "./contextDecayViz";
import type { RepoContextRow } from "./contextHealthModel";

const row = (over: Partial<RepoContextRow> & { fullName: string }): RepoContextRow => ({
  name: over.fullName.split("/")[1] ?? over.fullName,
  scanned: true,
  assessed: true,
  present: true,
  primaryPath: "CLAUDE.md",
  ageDays: 10,
  commitsSinceEdit: 0,
  windowCapped: false,
  potency: 100,
  halfLifeDays: 30,
  quality: 70,
  refsTotal: 0,
  deadRefs: [],
  score: 70,
  commitsPerWeek: 3,
  band: "fresh",
  verdict: "",
  ...over,
});

describe("points", () => {
  it("plots only repos with BOTH a potency and a commit count", () => {
    const field = decayField([
      row({ fullName: "a/measured", potency: 40, commitsSinceEdit: 120 }),
      row({ fullName: "a/unknown", potency: null, commitsSinceEdit: 50 }),
      row({ fullName: "a/no-commits", potency: 60, commitsSinceEdit: null }),
    ]);
    expect(field.points.map((p) => p.id)).toEqual(["a/measured"]);
    expect(field.unknown).toBe(1);
  });

  it("flags a repo under the 50% rule as past half-life", () => {
    const field = decayField([
      row({ fullName: "a/x", potency: 49, commitsSinceEdit: 10 }),
      row({ fullName: "a/y", potency: 51, commitsSinceEdit: 10 }),
    ]);
    expect(field.points.map((p) => p.pastHalfLife)).toEqual([true, false]);
  });

  it("counts an unassessed repo and a repo with no guidance as DIFFERENT absences", () => {
    const field = decayField([
      row({ fullName: "a/absent", present: false, potency: null, commitsSinceEdit: null, band: "absent" }),
      row({ fullName: "a/old", assessed: false, present: false, potency: null, commitsSinceEdit: null, band: null }),
    ]);
    expect(field.absent).toBe(1);
    expect(field.notAssessed).toBe(1);
    expect(field.states).toEqual(["not-judged", "missing"]);
  });

  it("never lets an unmeasured repo enter the plot at zero", () => {
    const field = decayField([row({ fullName: "a/x", potency: null, commitsSinceEdit: null })]);
    expect(field.points).toHaveLength(0);
    expect(field.states).toEqual(["not-judged"]);
  });
});

describe("median decay rate", () => {
  it("recovers a repo's own half-commits from its potency and commit count", () => {
    // 50% potency after 100 commits ⇒ the half-life IS 100 commits.
    const field = decayField([row({ fullName: "a/x", potency: 50, commitsSinceEdit: 100 })]);
    expect(field.halfCommits).toBeCloseTo(100, 5);
  });

  it("excludes repos that carry no rate information rather than assuming one", () => {
    const field = decayField([
      row({ fullName: "a/full", potency: 100, commitsSinceEdit: 40 }), // never decayed
      row({ fullName: "a/quiet", potency: 80, commitsSinceEdit: 0 }), // no commits to decay under
    ]);
    expect(field.halfCommits).toBeNull();
    expect(decayCurve(field)).toEqual([]);
  });

  it("samples a curve that starts at full potency and falls monotonically", () => {
    const field = decayField([row({ fullName: "a/x", potency: 50, commitsSinceEdit: 100 })]);
    const curve = decayCurve(field, 4);
    expect(curve[0]).toMatchObject({ x: 0, y: 100 });
    expect(curve.at(-1)!.y).toBeCloseTo(50, 5);
    for (let i = 1; i < curve.length; i++) expect(curve[i]!.y).toBeLessThan(curve[i - 1]!.y);
  });

  it("keeps an x-domain even when nothing has landed since the edit", () => {
    expect(decayField([row({ fullName: "a/x", potency: 90, commitsSinceEdit: 0 })]).maxCommits).toBe(1);
  });
});

describe("days", () => {
  it("uses the coarsest honest unit, and ∞ for a repo that never decays", () => {
    expect(days(0.4)).toBe("<1d");
    expect(days(12)).toBe("12d");
    expect(days(120)).toBe("4.0mo");
    expect(days(Number.POSITIVE_INFINITY)).toBe("∞");
  });
});
