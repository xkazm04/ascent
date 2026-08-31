// The catalog fell two codes behind the `GateFailure` union (`provenance`, `incomplete`), so a fleet
// failing for either rendered a card with no bar for it. Exhaustiveness is now enforced at COMPILE time
// by the `Record<GateFailure["code"], string>` — this file pins what a type cannot: that the two
// missing codes are actually present, that the keys are unique, and that no label is blank (a Record
// forces a key, not a legible one).

import { describe, expect, it } from "vitest";
import { FLEET_UNJUDGED_REASONS, GOVERNANCE_FAIL_REASONS, unjudgedBarsDeclared } from "./governanceReasons";

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
