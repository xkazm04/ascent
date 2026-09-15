// The admission ladder — "the tier a scan DERIVES is a measurement, admission is the decision" as an
// encoding rather than as a sentence.
//
// The invariant worth pinning is the one a refactor would quietly lose: a repo with no passport and
// no decision must be the VOID. It has no admission row, the gate applies no bar to it, and any mark
// at all would claim an enforcement that is not there.

import { describe, expect, it } from "vitest";
import { admissionBands, admissionEdge, admissionStates, viewState } from "./admissionLadder";
import type { AdmissionView } from "./admissionRows";

const view = (over: Partial<AdmissionView>): AdmissionView => ({
  fullName: "acme/api",
  name: "api",
  mode: "assisted-only",
  tier: "T1",
  decided: false,
  decidedBy: null,
  overridesDerived: null,
  stale: false,
  rulesetId: null,
  unassessed: false,
  ...over,
});

describe("viewState", () => {
  it("is the void for a repo nothing is recorded or measured for", () => {
    expect(viewState(view({ unassessed: true, tier: null }))).toBe("missing");
  });

  it("rings a repo a PERSON decided", () => {
    expect(viewState(view({ decided: true, decidedBy: "octocat" }))).toBe("decided");
  });

  it("treats the seed copied from the derived tier as a measurement, not a decision", () => {
    expect(viewState(view({}))).toBe("measured");
  });
});

describe("admissionBands", () => {
  it("stacks the rungs most-permissive-first and counts only repos actually held to one", () => {
    const bands = admissionBands([
      view({ mode: "agents-allowed", decided: true, decidedBy: "octocat" }),
      view({ fullName: "acme/web", name: "web", mode: "blocked" }),
      view({ fullName: "acme/x", name: "x", unassessed: true, tier: null }),
    ]);
    expect(bands.map((b) => b.id)).toEqual(["agents-allowed", "assisted-only", "blocked"]);
    // The ring goes on the rung somebody decided; the seeded rung stays a measurement.
    expect(bands[0]).toMatchObject({ state: "decided", count: 1 });
    expect(bands[2]).toMatchObject({ state: "measured", count: 1 });
    // The unassessed repo is in NO band — it crosses the edge instead.
    expect(bands[1]!.count).toBe(0);
  });
});

describe("admissionEdge", () => {
  it("is null when every repo has a rung", () => {
    expect(admissionEdge([view({})])).toBeNull();
  });

  it("carries the unassessed repos out past the outer boundary as a void", () => {
    expect(admissionEdge([view({ unassessed: true, tier: null })])).toMatchObject({ count: 1, state: "missing" });
  });
});

describe("admissionStates", () => {
  it("offers the legend only the states present, in the vocabulary's order", () => {
    expect(
      admissionStates([
        view({}),
        view({ fullName: "acme/web", name: "web", decided: true, decidedBy: "octocat" }),
        view({ fullName: "acme/x", name: "x", unassessed: true, tier: null }),
      ]),
    ).toEqual(["measured", "missing", "decided"]);
  });
});
