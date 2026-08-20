// The credit matrix's capability rows are DERIVED from the plan model (src/lib/plans.ts), not typed
// alongside it. This pins the join: every gated capability appears exactly once in the matrix, and
// every cell says what the entitlement gate would say for that tier.
//
// Before the derivation, these rows were hand-written with hand-written `from(tier)` cells, so the
// matrix could promise a tier a capability the gate refused — and two gated capabilities (Shared org
// memory, PDF export) were missing from the table altogether, sold nowhere and enforced anyway.

import { describe, it, expect } from "vitest";
import { PLAN_CAPABILITIES, PLAN_CAPABILITY_ORDER, PLAN_ORDER, planAllows } from "@/lib/plans";
import { MATRIX_GROUPS, MATRIX_PLANS } from "./creditMatrixData";

const capabilitiesGroup = MATRIX_GROUPS.find((g) => g.key === "capabilities")!;
const rowFor = (label: string) => capabilitiesGroup.rows.find((r) => r.label === label);

describe("credit matrix — the capability rows are the gate, rendered", () => {
  it("lists every gated capability, once, under its model label", () => {
    for (const cap of PLAN_CAPABILITY_ORDER) {
      const label = PLAN_CAPABILITIES[cap].label;
      const matches = capabilitiesGroup.rows.filter((r) => r.label === label);
      expect(matches, label).toHaveLength(1);
    }
  });

  it("every cell agrees with planAllows() for that tier — the page cannot oversell the gate", () => {
    // The suite runs with ASCENT_SELF_HOSTED=0 pinned (vitest.config.js), so this is the CLOUD matrix,
    // which is the one /pricing is describing. A self-hosted build has no pricing page to contradict.
    for (const cap of PLAN_CAPABILITY_ORDER) {
      const row = rowFor(PLAN_CAPABILITIES[cap].label)!;
      for (const plan of PLAN_ORDER) {
        expect(row.cells[plan], `${cap} @ ${plan}`).toBe(planAllows(cap, plan));
      }
    }
  });

  it("marks capability rows as included-in-plan, never as credit-metered", () => {
    // The whole point of the matrix: credits buy exactly one thing (a scan past the allowance).
    for (const cap of PLAN_CAPABILITY_ORDER) expect(rowFor(PLAN_CAPABILITIES[cap].label)!.tag).toBe("plan");
  });

  it("still carries the ungated rows the model deliberately does not gate", () => {
    // Segments/Playbooks are advertised but enforced nowhere (docs/features/billing/billing.md).
    // They stay hand-written rows precisely so the derived ones mean "enforced".
    expect(rowFor("Segments + comparisons")).toBeDefined();
    expect(rowFor("Playbooks + planning")).toBeDefined();
  });

  it("keeps one column per tier, in ladder order", () => {
    expect(MATRIX_PLANS.map((p) => p.id)).toEqual(PLAN_ORDER);
  });
});
