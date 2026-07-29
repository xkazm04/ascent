// Pins the "honest simulated-mode verdicts" contract of the AI-delivery model: the two SPEND-DERIVED
// verdicts (idle/shadow) rest on the spend/plan layer, which is a deterministic FNV placeholder until a
// provider is connected. In simulated mode they must NOT be assigned — a repo that would read "shadow"
// (adopted, no plan) or "idle" (paying, low AI) instead falls through to its git-derived verdict
// (ungoverned/working/starter). measured/allocated modes keep the full taxonomy unchanged.

import { describe, it, expect } from "vitest";
import { buildAiDeliveryModel } from "./aiDeliveryModel";
import type { OrgPrSignals, OrgUsageRollup } from "@/lib/db";

function prRow(over: Partial<OrgPrSignals["perRepo"][number]> = {}): OrgPrSignals["perRepo"][number] {
  return {
    fullName: "acme/api",
    name: "api",
    analyzed: 100,
    mergeRate: 90,
    reviewedRate: 80,
    smallPrRate: 40,
    aiInvolvedRate: 50, // adopted (>= ADOPT_HI 15)
    aiGovernedRate: 90, // governed (>= GOV_HI 60)
    medianHoursToMerge: 10,
    ...over,
  };
}

function signals(perRepo: OrgPrSignals["perRepo"]): OrgPrSignals {
  return {
    repos: perRepo.length,
    totalPrs: perRepo.reduce((s, r) => s + r.analyzed, 0),
    avgMergeRate: 90,
    avgReviewedRate: 80,
    avgSmallPrRate: 40,
    avgAiInvolvedRate: 50,
    avgAiGovernedRate: 90,
    typicalHoursToMerge: 10,
    tools: [{ name: "Claude", count: 3 }],
    perRepo,
  };
}

// A measured rollup that assigns real spend to `acme/paying` (idle candidate) and NO telemetry to
// `acme/ghost` (shadow candidate — adopted in git, no plan/seats).
function measuredUsage(): OrgUsageRollup {
  return {
    hasMeasured: true,
    hasAllocated: false,
    perRepo: { "acme/paying": { source: "claude-code", costCents: 120_000, seats: 20, tokens: 0, sessions: 0 } },
    orgTotals: [],
    sources: ["claude-code"],
  } as unknown as OrgUsageRollup;
}

// Fleet: one governed+adopted repo, one adopted repo with no plan (would be shadow), one low-adoption
// repo (idle only if it's paying real money).
const fleet = signals([
  prRow({ fullName: "acme/api", name: "api", aiInvolvedRate: 50, aiGovernedRate: 90 }), // working
  prRow({ fullName: "acme/ghost", name: "ghost", aiInvolvedRate: 40, aiGovernedRate: 90 }), // shadow if unplanned
  prRow({ fullName: "acme/paying", name: "paying", aiInvolvedRate: 5, aiGovernedRate: null }), // idle if paying
]);

describe("buildAiDeliveryModel — simulated mode suppresses spend-derived verdicts", () => {
  it("assigns no idle or shadow verdicts when spend is simulated (no provider connected)", () => {
    const m = buildAiDeliveryModel(fleet, null)!;
    expect(m.fidelity).toBe("simulated");
    expect(m.summary.counts.idle).toBe(0);
    expect(m.summary.counts.shadow).toBe(0);
    // Every repo carries only a git-derived verdict.
    for (const r of m.repos) expect(["ungoverned", "working", "starter"]).toContain(r.verdict);
  });

  it("a low-adoption repo reads 'starter' (not 'idle') in simulated mode even if its placeholder spend is high", () => {
    const m = buildAiDeliveryModel(signals([prRow({ fullName: "acme/paying", name: "paying", aiInvolvedRate: 5, aiGovernedRate: null })]), null)!;
    expect(m.repos[0]!.verdict).toBe("starter");
  });

  it("an adopted+ungoverned repo still reads 'ungoverned' in simulated mode (governance is git-real)", () => {
    const m = buildAiDeliveryModel(signals([prRow({ aiInvolvedRate: 50, aiGovernedRate: 20 })]), null)!;
    expect(m.repos[0]!.verdict).toBe("ungoverned");
  });
});

describe("buildAiDeliveryModel — measured mode keeps the full taxonomy (unchanged)", () => {
  it("assigns idle to a paying+low-adoption repo and shadow to an adopted+unplanned repo", () => {
    const m = buildAiDeliveryModel(fleet, measuredUsage())!;
    expect(m.fidelity).toBe("measured");
    const byName = Object.fromEntries(m.repos.map((r) => [r.name, r.verdict]));
    expect(byName.paying).toBe("idle"); // real $1,200/mo, 5% AI reach
    expect(byName.ghost).toBe("shadow"); // adopted in git, no telemetry → no plan
    expect(m.summary.counts.idle).toBeGreaterThanOrEqual(1);
    expect(m.summary.counts.shadow).toBeGreaterThanOrEqual(1);
  });
});
