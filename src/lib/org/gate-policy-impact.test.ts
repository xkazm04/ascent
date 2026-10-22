// Pins the gate-policy PREVIEW: what a draft bar would do to the fleet, computed BEFORE the write by
// the same evaluator the governance tab and the CI gate use (evaluateGateLite), and the same field
// diff the POST used to report only after the bar was already gone (diffGatePolicy).

import { describe, it, expect } from "vitest";
import { gatePolicyImpact } from "./gate-policy-impact";
import type { FleetGateRow } from "./fleet-gate-snapshot";
import { fleetFromRows } from "@/lib/scoring/gate-resolve";
import type { GateSnapshot } from "@/lib/scoring/gate";
import type { RepoAdmissionRow } from "@/lib/org/admission";

const DIMS_OK = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"].map((dimId) => ({ dimId, score: 70 }));

function repo(fullName: string, snap: Partial<GateSnapshot> = {}): FleetGateRow {
  return {
    name: fullName.split("/")[1] ?? fullName,
    fullName,
    snapshot: { level: "L3", overall: 70, posture: "governed", dims: DIMS_OK, ...snap },
  };
}

describe("gatePolicyImpact - who flips", () => {
  it("tightening min overall turns a 55 repo red, with the evaluator's own sentence", () => {
    const impact = gatePolicyImpact([repo("acme/a", { overall: 55 })], { minLevel: "L2" }, { minLevel: "L2", minOverall: 60 });
    expect(impact.before.passing).toBe(1);
    expect(impact.after.passing).toBe(0);
    expect(impact.newlyFailing).toEqual([
      { fullName: "acme/a", name: "a", overall: 55, reasons: ["Overall score 55 is below the required 60."] },
    ]);
    expect(impact.newlyPassing).toEqual([]);
  });

  it("relaxing a dimension floor turns a repo green and turns none red", () => {
    const dims = DIMS_OK.map((d) => (d.dimId === "D3" ? { ...d, score: 35 } : d));
    const impact = gatePolicyImpact([repo("acme/b", { dims })], { minDimension: 40 }, { minDimension: 30 });
    expect(impact.newlyPassing.map((r) => r.fullName)).toEqual(["acme/b"]);
    expect(impact.newlyFailing).toEqual([]);
    expect(impact.before.failing).toBe(1);
    expect(impact.after.failing).toBe(0);
  });
});

describe("gatePolicyImpact - honest nulls", () => {
  it("a new protection bar on an unreadable repo is UNTESTED, never a new failure", () => {
    const impact = gatePolicyImpact(
      [repo("acme/c", { govReadable: false }), repo("acme/d", { govReadable: true, protected: false })],
      { minLevel: "L2" },
      { minLevel: "L2", requireProtectedBranch: true },
    );
    expect(impact.newlyFailing.map((r) => r.fullName)).toEqual(["acme/d"]);
    expect(impact.untested.governance).toBe(1);
  });

  it("a bar that was already untested for a repo is not counted as newly untested", () => {
    const p = { requireProtectedBranch: true };
    const impact = gatePolicyImpact([repo("acme/c", { govReadable: false })], p, { ...p, minOverall: 10 });
    expect(impact.untested.governance ?? 0).toBe(0);
  });

  it("incomplete snapshots are excluded from both sides and counted apart", () => {
    const impact = gatePolicyImpact(
      [repo("acme/e", { incomplete: true, overall: 0, level: "L1" }), repo("acme/f", { dims: [] })],
      { minLevel: "L1" },
      { minLevel: "L5", minOverall: 99 },
    );
    expect(impact.unjudged.incomplete).toBe(2);
    expect(impact.newlyFailing).toEqual([]);
    expect(impact.newlyPassing).toEqual([]);
    expect(impact.assessed).toBe(0);
    expect(impact.before).toEqual({ passing: 0, failing: 0 });
  });
});

describe("gatePolicyImpact - removed bars, before the save", () => {
  it("names a dropped required control with the same diff the POST reports", () => {
    const impact = gatePolicyImpact([], { requireChecks: ["control.prepush.lint"], minOverall: 50 }, { minOverall: 50 });
    expect(impact.removed).toHaveLength(1);
    expect(impact.removed[0].label).toBe("required controls");
    expect(impact.removed[0].was).toContain("control.prepush.lint");
  });

  it("an unchanged bar removes nothing", () => {
    expect(gatePolicyImpact([], { minOverall: 50 }, { minOverall: 50 }).removed).toEqual([]);
  });
});

describe("gatePolicyImpact - through the fleet resolver", () => {
  it("judges each repo on its admission-folded bar, on both sides", () => {
    // acme/h is admitted at T1, whose overlay requires a protected branch. Relaxing the ORG bar would
    // turn it green on the org bar alone; on its folded bar (what the Check Run enforces) it stays red.
    const row = { repoFullName: "acme/h", mode: "agents-allowed", derivedTier: "T1", grantedTier: "T1" } as unknown as RepoAdmissionRow;
    const h = repo("acme/h", { overall: 70, govReadable: true, protected: false });
    const before = fleetFromRows({ minOverall: 80 }, "org", [row]);
    const after = fleetFromRows({ minOverall: 60 }, "org", [row]);
    const folded = gatePolicyImpact(
      [h],
      { stored: { minOverall: 80 }, policyFor: before.policyFor },
      { stored: { minOverall: 60 }, policyFor: after.policyFor },
    );
    expect(folded.newlyPassing).toEqual([]);
    expect(folded.after.failing).toBe(1);
    // Control: the bare org bars WOULD have flipped it, so the overlay is what held it.
    expect(gatePolicyImpact([h], { minOverall: 80 }, { minOverall: 60 }).newlyPassing.map((r) => r.fullName)).toEqual(["acme/h"]);
  });
});
