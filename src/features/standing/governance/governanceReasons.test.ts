// The catalog fell two codes behind the `GateFailure` union (`provenance`, `incomplete`), so a fleet
// failing for either rendered a card with no bar for it. Exhaustiveness is now enforced at COMPILE time
// by the `Record<GateFailure["code"], string>` — this file pins what a type cannot: that the two
// missing codes are actually present, that the keys are unique, and that no label is blank (a Record
// forces a key, not a legible one).

import { describe, expect, it } from "vitest";
import { GOVERNANCE_FAIL_REASONS } from "./governanceReasons";

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
