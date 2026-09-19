// The audit trail's other half: a policy write that DROPS a bar has to say so.
//
// UAT 2026-08-30 (NADIA-L1-07). The row the product wrote for the save that deleted two required
// controls:
//
//   {"action":"set","status":"min L3 · min overall 55 · no dim < 40",
//    "policy":{"minLevel":"L3","minOverall":55,"minDimension":40},
//    "previousPolicy":{…,"requireChecks":["control.prepush.lint","guardrail.never-commit"]}}
//
// The deleted bar appears once, in a field nobody diffs. `status` — the line the audit viewer renders
// — is silent. Nadia's verdict: "the system knows precisely what it destroyed and the operator is
// never told." These tests pin the diff that makes the drop legible.

import { describe, it, expect } from "vitest";
import { diffGatePolicy, droppedGatePolicyFields, summarizeGatePolicyDiff } from "./gate-diff";
import type { GatePolicy } from "./gate";

const BEFORE: GatePolicy = {
  minLevel: "L3",
  minOverall: 50,
  minDimension: 40,
  requireChecks: ["control.prepush.lint", "guardrail.never-commit"],
};

describe("diffGatePolicy", () => {
  it("names the field a wholesale replace deleted — the live capture", () => {
    const after: GatePolicy = { minLevel: "L3", minOverall: 55, minDimension: 40 };
    const dropped = droppedGatePolicyFields(BEFORE, after);

    expect(dropped).toHaveLength(1);
    expect(dropped[0].field).toBe("requireChecks");
    expect(dropped[0].label).toBe("required controls");
    // The `before` sentence is describeGatePolicy's own, so the log can never advertise a bar in
    // different words than the dashboard used while it was in force.
    expect(dropped[0].before).toContain("control.prepush.lint");
    expect(dropped[0].before).toContain("guardrail.never-commit");
  });

  it("classifies the same save's edited field as changed, not dropped", () => {
    const changes = diffGatePolicy(BEFORE, { minLevel: "L3", minOverall: 55, minDimension: 40 });
    const overall = changes.find((c) => c.field === "minOverall");

    expect(overall?.kind).toBe("changed");
    expect(overall?.before).toBe("Overall score ≥ 50");
    expect(overall?.after).toBe("Overall score ≥ 55");
    // …and the untouched fields produce nothing at all.
    expect(changes.map((c) => c.field).sort()).toEqual(["minOverall", "requireChecks"]);
  });

  it("reports an added bar as added, so the summary can stay quiet about it", () => {
    const changes = diffGatePolicy({ minOverall: 50 }, { minOverall: 50, requireProtectedBranch: true });
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("added");
    // The bar bits in the audit `status` already show what was added; only losses need the clause.
    expect(summarizeGatePolicyDiff(changes)).toBe("");
  });

  it("treats an empty list / false as unset, matching the sanitizer", () => {
    // `{ requireChecks: [] }` is not a bar. A diff that called it a value would report a phantom drop
    // on every save, and an audit trail that cries wolf is not read.
    expect(diffGatePolicy({ requireChecks: [] }, {})).toEqual([]);
    expect(diffGatePolicy({ forbidAiAuthorship: false }, {})).toEqual([]);
    expect(diffGatePolicy({ minDimensionFor: {} }, {})).toEqual([]);
  });

  it("diffs per-dimension floors as one field, in describeGatePolicy's wording", () => {
    const changes = diffGatePolicy({ minDimensionFor: { D2: 45, D9: 70 } }, { minDimensionFor: { D9: 70 } });
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe("changed");
    expect(changes[0].before).toContain("D2");
    expect(changes[0].after).not.toContain("D2");
  });

  it("handles a policy set from nothing, and one cleared to nothing", () => {
    expect(diffGatePolicy(null, BEFORE).every((c) => c.kind === "added")).toBe(true);
    expect(diffGatePolicy(BEFORE, null).every((c) => c.kind === "removed")).toBe(true);
    expect(diffGatePolicy(null, null)).toEqual([]);
  });
});

describe("summarizeGatePolicyDiff — the clause the audit `status` carries", () => {
  it("appends the drop to the bar bits so a human reading one line sees the loss", () => {
    const clause = summarizeGatePolicyDiff(diffGatePolicy(BEFORE, { minLevel: "L3", minOverall: 55, minDimension: 40 }));

    expect(clause).toContain("dropped required controls");
    expect(clause).toContain("control.prepush.lint");
    expect(clause).toContain("Overall score ≥ 50 → Overall score ≥ 55");
    expect(clause.startsWith(" — ")).toBe(true);
  });

  it("says nothing when a save neither dropped nor loosened anything", () => {
    expect(summarizeGatePolicyDiff(diffGatePolicy(BEFORE, BEFORE))).toBe("");
  });
});
