// The catalog fell two codes behind the `GateFailure` union (`provenance`, `incomplete`), so a fleet
// failing for either rendered a card with no bar for it. Exhaustiveness is now enforced at COMPILE time
// by the `Record<GateFailure["code"], string>` — this file pins what a type cannot: that the two
// missing codes are actually present, that the keys are unique, and that no label is blank (a Record
// forces a key, not a legible one).

import { describe, expect, it } from "vitest";
import {
  FLEET_UNJUDGED_REASONS,
  GOVERNANCE_FAIL_REASONS,
  earnedZeroNote,
  unjudgedBarDeclaration,
  unjudgedBarsDeclared,
} from "./governanceReasons";

describe("GOVERNANCE_FAIL_REASONS", () => {
  it("carries the two codes the hand-maintained array had dropped", () => {
    const keys = GOVERNANCE_FAIL_REASONS.map((r) => r.key);
    expect(keys).toContain("provenance");
    expect(keys).toContain("incomplete");
  });

  it("has one unique, non-empty label per code", () => {
    const keys = GOVERNANCE_FAIL_REASONS.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of GOVERNANCE_FAIL_REASONS) expect(r.label.trim()).not.toBe("");
  });
});

// UAT 2026-08-30, PRIYA-L1-02. A lead who had just declared two required controls read
// "A required control is failing — 0 repos" on the dashboard while the per-repo CI gate blocked PRs on
// exactly those controls. The zero is structural: `evaluateGateLite` scores from rollup numbers, which
// carry no conformance ledger and no PR stats, so `control` (#16) and `admission` (#8) are skipped on
// every repo, every time. governance.ts says so in a comment; the comment never reached the screen.
describe("fleet-unjudged conditions", () => {
  it("marks exactly the two conditions the fleet path can never evaluate", () => {
    expect([...FLEET_UNJUDGED_REASONS].sort()).toEqual(["admission", "control"]);
  });

  it("keeps the genuinely-measured lookalikes judged — their zeros are earned", () => {
    // The rollup carries the branch-protection fields and aiGovernedRate/aiPrSample, and
    // evaluateGateLite evaluates both (honest-null skip per repo). Marking them unjudged would hide a
    // real fleet measurement behind a caveat, which is the same dishonesty pointed the other way.
    const judged = Object.fromEntries(GOVERNANCE_FAIL_REASONS.map((r) => [r.key, r.fleetJudged]));
    expect(judged.governance).toBe(true);
    expect(judged.provenance).toBe(true);
    expect(judged.control).toBe(false);
    expect(judged.admission).toBe(false);
  });

  it("detects when the org's stored bar actually declares one of them", () => {
    expect(unjudgedBarsDeclared({ requireChecks: ["control.prepush.lint"] })).toBe(true);
    expect(unjudgedBarsDeclared({ forbidAiAuthorship: true })).toBe(true);
    expect(unjudgedBarsDeclared({ minOverall: 50 })).toBe(false);
    expect(unjudgedBarsDeclared({ requireChecks: [] })).toBe(false);
    expect(unjudgedBarsDeclared(null)).toBe(false);
  });
});

// UAT `RC-N2` (recertify pass 1). `unjudgedBarsDeclared` reached only the all-clear sentence, so the
// two unjudged ROWS printed the identical em-dash line for an org that had declared nothing and for
// one that had just set two required controls.
describe("unjudgedBarDeclaration", () => {
  it("names the operator's own count on the control row, and pluralizes it", () => {
    expect(unjudgedBarDeclaration("control", { requireChecks: ["control.prepush.lint", "guardrail.never-commit"] })).toBe(
      "you have declared 2 required controls; the per-repo gate enforces them",
    );
    expect(unjudgedBarDeclaration("control", { requireChecks: ["control.prepush.lint"] })).toBe(
      "you have declared 1 required control; the per-repo gate enforces it",
    );
  });

  it("speaks for the admission row only when the AI-authorship bar is actually declared", () => {
    expect(unjudgedBarDeclaration("admission", { forbidAiAuthorship: true })).toContain("the per-repo gate enforces it");
    expect(unjudgedBarDeclaration("admission", { forbidAiAuthorship: false })).toBeNull();
  });

  it("stays silent when she has declared nothing under the row — an empty escalation is worse than none", () => {
    expect(unjudgedBarDeclaration("control", { requireChecks: [] })).toBeNull();
    expect(unjudgedBarDeclaration("control", null)).toBeNull();
    expect(unjudgedBarDeclaration("admission", null)).toBeNull();
    // A declared control says nothing about the admission row, and vice versa.
    expect(unjudgedBarDeclaration("admission", { requireChecks: ["control.prepush.lint"] })).toBeNull();
    // Never on a judged row: those have a meter, and the meter speaks for itself.
    expect(unjudgedBarDeclaration("governance", { requireChecks: ["control.prepush.lint"] })).toBeNull();
  });
});

// UAT `RC-N3` (recertify pass 1). `provenance` and `governance` zeros ARE measurements; beside two
// rows that now read "not judged fleet-wide" a bare 0 reads as the placeholder it is not.
describe("earnedZeroNote", () => {
  const measuredOn = { governance: 12, provenance: 3 };
  const barSet = { governance: true, provenance: true };

  it("states the N a measured zero was reached on", () => {
    expect(earnedZeroNote("governance", 0, 14, measuredOn, barSet)).toBe("measured on 12 of 14 judged repos");
    expect(earnedZeroNote("provenance", 0, 14, measuredOn, barSet)).toBe("measured on 3 of 14 judged repos");
  });

  it("says nothing when the meter is non-zero — the number already speaks", () => {
    expect(earnedZeroNote("governance", 4, 14, measuredOn, barSet)).toBeNull();
  });

  it("carries no note for a code whose inputs are present on every judged repo", () => {
    expect(earnedZeroNote("overall", 0, 14, measuredOn, barSet)).toBeNull();
    expect(earnedZeroNote("control", 0, 14, measuredOn, barSet)).toBeNull();
  });

  it("distinguishes a bar nobody set from a bar every measured repo cleared", () => {
    expect(earnedZeroNote("provenance", 0, 14, measuredOn, { ...barSet, provenance: false })).toBe(
      "not part of this org's bar",
    );
  });

  it("refuses to call an unmeasured zero measured", () => {
    expect(earnedZeroNote("provenance", 0, 14, { ...measuredOn, provenance: 0 }, barSet)).toBe(
      "no judged repo carried the inputs (0 of 14)",
    );
    expect(earnedZeroNote("provenance", 0, 0, { ...measuredOn, provenance: 0 }, barSet)).toBe("nothing judged yet");
  });
});
