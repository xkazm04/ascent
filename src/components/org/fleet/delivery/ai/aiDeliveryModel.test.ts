// Pins the "honest no-cost-source verdicts" contract of the AI-delivery model: the two SPEND-DERIVED
// verdicts (idle/shadow) rest on the spend/plan layer, which is a deterministic FNV placeholder until a
// provider is connected. With no cost source they must NOT be assigned — a repo that would read "shadow"
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
    hasAllocatedCost: false,
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

describe("buildAiDeliveryModel — no cost source suppresses spend-derived verdicts", () => {
  it("assigns no idle or shadow verdicts when no provider reports cost", () => {
    const m = buildAiDeliveryModel(fleet, null)!;
    expect(m.fidelity).toBe("none");
    expect(m.summary.counts.idle).toBe(0);
    expect(m.summary.counts.shadow).toBe(0);
    // Every repo carries only a git-derived verdict.
    for (const r of m.repos) expect(["ungoverned", "working", "starter"]).toContain(r.verdict);
  });

  it("a low-adoption repo reads 'starter' (not 'idle') with no cost source — there is no spend to call idle", () => {
    const m = buildAiDeliveryModel(signals([prRow({ fullName: "acme/paying", name: "paying", aiInvolvedRate: 5, aiGovernedRate: null })]), null)!;
    expect(m.repos[0]!.verdict).toBe("starter");
  });

  it("an adopted+ungoverned repo still reads 'ungoverned' with no cost source (governance is git-real)", () => {
    const m = buildAiDeliveryModel(signals([prRow({ aiInvolvedRate: 50, aiGovernedRate: 20 })]), null)!;
    expect(m.repos[0]!.verdict).toBe("ungoverned");
  });
});

describe("buildAiDeliveryModel — allocated mode prefers trailer-grounded weights (W2)", () => {
  // An org-level connected total, no per-repo telemetry → "allocated" fidelity.
  const allocatedUsage = () =>
    ({
      hasMeasured: false,
      hasAllocated: true,
      hasAllocatedCost: true,
      perRepo: {},
      orgTotals: [{ source: "claude-code", costCents: 100_000, seats: 10, tokens: 0, sessions: 0 }],
      sources: ["claude-code"],
    }) as unknown as OrgUsageRollup;

  it("splits the org total by trailer-attributed PR volume when scans carry aiTrailerRate", () => {
    // Identical marker rates (50/50 split under the old weight); trailers say 40% vs 10% → 80/20.
    const m = buildAiDeliveryModel(
      signals([
        prRow({ fullName: "acme/a", name: "a", analyzed: 100, aiInvolvedRate: 50, aiTrailerRate: 40, aiPreReviewedRate: null }),
        prRow({ fullName: "acme/b", name: "b", analyzed: 100, aiInvolvedRate: 50, aiTrailerRate: 10, aiPreReviewedRate: null }),
      ]),
      allocatedUsage(),
    )!;
    expect(m.fidelity).toBe("allocated");
    const byName = Object.fromEntries(m.repos.map((r) => [r.name, r.monthlySpend]));
    expect(byName.a).toBe(800); // 40/(40+10) of $1,000
    expect(byName.b).toBe(200);
  });

  it("falls back to the marker-based weight for repos whose scans predate trailer tracking", () => {
    const m = buildAiDeliveryModel(
      signals([
        prRow({ fullName: "acme/a", name: "a", analyzed: 100, aiInvolvedRate: 30 }), // pre-W2 row: no trailer fields
        prRow({ fullName: "acme/b", name: "b", analyzed: 100, aiInvolvedRate: 70 }),
      ]),
      allocatedUsage(),
    )!;
    const byName = Object.fromEntries(m.repos.map((r) => [r.name, r.monthlySpend]));
    expect(byName.a).toBe(300); // 30/(30+70) — unchanged legacy behavior
    expect(byName.b).toBe(700);
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// W3b/W3c — a connected provider that reports SEATS BUT NO COST must not be mistaken for a cost
// source. This is the specific trap the Copilot connector walks into: it produces real allocated
// records whose costCents is legitimately 0, and entering the allocated branch on those would divide
// a zero total across every repo and render the whole fleet as "$0 spend / shadow AI" — connected,
// confident, and entirely wrong.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe("buildAiDeliveryModel — a cost-less connector is not a cost source", () => {
  const seatsOnly = {
    hasMeasured: false,
    hasAllocated: true,
    hasAllocatedCost: false,
    perRepo: {},
    orgTotals: [{ source: "copilot", costCents: 0, seats: 40, tokens: 0 }],
    sources: ["copilot"],
  };

  it("stays on the 'none' tier when the only connected source reports no cost", () => {
    expect(buildAiDeliveryModel(fleet, seatsOnly)!.fidelity).toBe("none");
  });

  it("never derives a spend verdict from a cost-less connector", () => {
    const m = buildAiDeliveryModel(fleet, seatsOnly)!;
    expect(m.repos.some((r) => r.verdict === "idle" || r.verdict === "shadow")).toBe(false);
  });

  it("reports zero spend rather than a fabricated allocation", () => {
    const m = buildAiDeliveryModel(fleet, seatsOnly)!;
    expect(m.summary.totalMonthlySpend).toBe(0);
    expect(m.repos.every((r) => r.monthlySpend === 0 && r.seats === 0)).toBe(true);
  });

  // The regression this whole change exists to prevent: no repo-name-derived pseudo-randomness may
  // reach a spend field. Two fleets differing only in repo NAMES must produce identical spend.
  it("produces spend that does not vary with the repository name", () => {
    const renamed = {
      ...fleet,
      perRepo: fleet.perRepo.map((r, i) => ({ ...r, fullName: `acme/zzz-${i}`, name: `zzz-${i}` })),
    };
    const a = buildAiDeliveryModel(fleet, null)!;
    const b = buildAiDeliveryModel(renamed, null)!;
    expect(a.summary.totalMonthlySpend).toBe(b.summary.totalMonthlySpend);
    expect(a.summary.totalSeats).toBe(b.summary.totalSeats);
    expect(a.repos.map((r) => r.monthlySpend)).toEqual(b.repos.map((r) => r.monthlySpend));
  });
});
