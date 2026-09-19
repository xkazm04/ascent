// moonshot #8 — the pure admission compiler. Two invariants carry the whole design and each has its
// own block below: the overlay is TIGHTEN-ONLY, and a null (unassessed) tier compiles NOTHING.

import { describe, it, expect } from "vitest";
import { admissionGateOverlay, compileStance, renderCodeownersBlock, renderRulesetProposal, type RepoAdmissionRow } from "./admission";
import { tightenGatePolicy, type GatePolicy } from "@/lib/scoring/gate";
import type { AiStance, AutonomyTierId } from "@/lib/types";

const STANCE: AiStance = {
  permittedTools: ["Claude Code"],
  permittedModels: [],
  noAiZones: [{ repoGlobs: [], pathGlobs: ["prisma/migrations/**", "infra/**"], reason: "regulated" }],
  reviewTiers: [{ tier: "T0", review: "Two approvals, one from the module owner." }],
  provenance: { requireTrailer: true, requireHumanApproval: true },
};

function row(o: Partial<RepoAdmissionRow> = {}): RepoAdmissionRow {
  return {
    id: "a1",
    repoFullName: "acme/billing",
    stanceVersion: 3,
    derivedTier: "T1",
    grantedTier: "T1",
    mode: "assisted-only",
    decidedBy: null,
    decidedAt: null,
    rationale: "",
    rulesetId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...o,
  };
}

const facts = (o: Partial<Parameters<typeof compileStance>[2]> = {}) => ({
  fullName: "acme/billing",
  derivedTier: "T1" as AutonomyTierId | null,
  codeownersPaths: [],
  observedRequiredApprovals: null,
  protectedBranch: true,
  ...o,
});

describe("admissionGateOverlay — the tier ladder", () => {
  it("T0 is the most oversight, and the bar relaxes as autonomy is earned", () => {
    expect(admissionGateOverlay("assisted-only", "T0")).toEqual({
      requireProtectedBranch: true,
      minAiGovernedRate: 100,
      forbidPostures: ["ungoverned"],
    });
    expect(admissionGateOverlay("assisted-only", "T1")).toEqual({ requireProtectedBranch: true, minAiGovernedRate: 100 });
    expect(admissionGateOverlay("assisted-only", "T2")).toEqual({ minAiGovernedRate: 90 });
    expect(admissionGateOverlay("assisted-only", "T3")).toEqual({});
  });

  it("an unassessed tier compiles an EMPTY overlay — never the strictest bar by default", () => {
    expect(admissionGateOverlay("assisted-only", null)).toEqual({});
    expect(admissionGateOverlay("agents-allowed", null)).toEqual({});
  });

  it('mode "blocked" forbids AI authorship at every tier, including an unassessed one', () => {
    // A block is a DECISION a person recorded, not a measurement — so unlike the tier floors it does
    // not need an assessed tier to mean something.
    expect(admissionGateOverlay("blocked", null)).toEqual({ forbidAiAuthorship: true });
    expect(admissionGateOverlay("blocked", "T3")).toEqual({ forbidAiAuthorship: true });
    expect(admissionGateOverlay("blocked", "T0").forbidAiAuthorship).toBe(true);
  });

  it('"agents-allowed" adds nothing beyond the tier floors — it is not a licence to loosen', () => {
    expect(admissionGateOverlay("agents-allowed", "T0")).toEqual(admissionGateOverlay("assisted-only", "T0"));
  });
});

describe("TIGHTEN-ONLY: an admission overlay can never weaken the bar it is folded into", () => {
  const strictOrg: GatePolicy = {
    minLevel: "L4",
    minOverall: 85,
    minDimension: 60,
    minDimensionFor: { D9: 90 },
    forbidPostures: ["ungoverned"],
    requireProtectedBranch: true,
    minAiGovernedRate: 100,
  };

  // The regression this guards: a T3 repo must receive NO extra floor, and must not be held to a
  // LOOSER bar than the org's either. The overlay is folded, never assigned.
  it("a T3 repo keeps every one of the org's bars", () => {
    expect(tightenGatePolicy(strictOrg, admissionGateOverlay("agents-allowed", "T3"))).toEqual(strictOrg);
  });

  it("no tier's overlay lowers any numeric bar the org set", () => {
    for (const tier of ["T0", "T1", "T2", "T3", null] as (AutonomyTierId | null)[]) {
      const merged = tightenGatePolicy(strictOrg, admissionGateOverlay("blocked", tier));
      expect(merged.minOverall).toBe(85);
      expect(merged.minDimension).toBe(60);
      expect(merged.minDimensionFor?.D9).toBe(90);
      expect(merged.minAiGovernedRate).toBe(100);
      expect(merged.minLevel).toBe("L4");
      expect(merged.requireProtectedBranch).toBe(true);
    }
  });

  it("a T0 overlay DOES raise a lenient org bar", () => {
    const lenient: GatePolicy = { minLevel: "L2", minAiGovernedRate: 50 };
    const merged = tightenGatePolicy(lenient, admissionGateOverlay("assisted-only", "T0"));
    expect(merged.minAiGovernedRate).toBe(100);
    expect(merged.requireProtectedBranch).toBe(true);
    expect(merged.forbidPostures).toContain("ungoverned");
    expect(merged.minLevel).toBe("L2"); // the overlay declares no level, so the org's stands
  });
});

describe("compileStance", () => {
  it("an unassessed tier compiles no control at all", () => {
    const c = compileStance(STANCE, row({ derivedTier: null, grantedTier: "T0" }), facts({ derivedTier: null }), 3);
    expect(c.tier).toBeNull();
    expect(c.tierSource).toBe("none");
    expect(c.gateOverlay).toEqual({});
    expect(c.ruleset).toBeNull();
    expect(c.manifestOversight).toBeNull();
  });

  it("distinguishes a SEEDED tier from a DECIDED one", () => {
    expect(compileStance(STANCE, row(), facts(), 3).tierSource).toBe("derived");
    expect(compileStance(STANCE, row({ decidedBy: "octocat" }), facts(), 3).tierSource).toBe("granted");
  });

  it("flags a decision made against an older stance without re-deciding it", () => {
    const c = compileStance(STANCE, row({ stanceVersion: 2, grantedTier: "T3", decidedBy: "octocat" }), facts(), 5);
    expect(c.staleDecision).toBe(true);
    // Recompiled against the ACTIVE stance, but the recorded grant is untouched.
    expect(c.tier).toBe("T3");
    expect(compileStance(STANCE, row({ stanceVersion: 5 }), facts(), 5).staleDecision).toBe(false);
  });

  it("publishes what stayed DECLARED, with the reason", () => {
    const c = compileStance(
      { ...STANCE, permittedModels: ["claude-opus"] },
      row(),
      facts({ protectedBranch: null }),
      3,
    );
    const clauses = c.unenforceable.map((u) => u.clause).join(" | ");
    expect(clauses).toContain("permittedModels");
    expect(clauses).toContain("permittedTools");
    expect(clauses).toContain("branch protection");
    // The model clause names WHY, so a reader is not left to guess it is an oversight.
    expect(c.unenforceable.find((u) => u.clause.startsWith("permittedModels"))!.why).toContain("model dimension");
  });

  it("the review-tier clause is unenforceable only while approvals are unobserved", () => {
    const unobserved = compileStance(STANCE, row(), facts({ observedRequiredApprovals: null }), 3);
    expect(unobserved.unenforceable.some((u) => u.clause.includes("review requirement"))).toBe(true);
    const observed = compileStance(STANCE, row(), facts({ observedRequiredApprovals: 2 }), 3);
    expect(observed.unenforceable.some((u) => u.clause.includes("review requirement"))).toBe(false);
  });
});

describe("renderCodeownersBlock", () => {
  it("is byte-stable for a given stance version", () => {
    const a = renderCodeownersBlock(STANCE, 3, ["@acme/platform"]);
    const b = renderCodeownersBlock(STANCE, 3, ["@acme/platform"]);
    expect(a).toBe(b);
    expect(a).toContain("# BEGIN ascent:ai-stance v3");
    expect(a).toContain("# END ascent:ai-stance v3");
    expect(a).toContain("infra/** @acme/platform");
  });

  it("sorts paths so a re-ordered stance does not produce a churn diff", () => {
    const reordered: AiStance = { ...STANCE, noAiZones: [{ repoGlobs: [], pathGlobs: ["infra/**", "prisma/migrations/**"] }] };
    expect(renderCodeownersBlock(reordered, 3, ["@a"])).toBe(renderCodeownersBlock(STANCE, 3, ["@a"]));
  });

  it("renders NOTHING rather than an empty managed block", () => {
    // An empty block is a diff that says nothing and still asks a human for a review.
    expect(renderCodeownersBlock({ ...STANCE, noAiZones: [] }, 3, ["@a"])).toBeNull();
    expect(renderCodeownersBlock(STANCE, 3, [])).toBeNull();
  });

  it("says plainly that it reviews rather than detects — CODEOWNERS cannot see authorship", () => {
    expect(renderCodeownersBlock(STANCE, 3, ["@a"])).toContain("not detect AI authorship");
  });
});

describe("renderRulesetProposal", () => {
  it("asks for two approvals at T0, one at T1, and none above", () => {
    expect(renderRulesetProposal("a/b", "T0", "assisted-only")!.rules.find((r) => r.type === "pull_request")!.parameters!
      .required_approving_review_count).toBe(2);
    expect(renderRulesetProposal("a/b", "T1", "assisted-only")!.rules.find((r) => r.type === "pull_request")!.parameters!
      .required_approving_review_count).toBe(1);
    expect(renderRulesetProposal("a/b", "T2", "assisted-only")).toBeNull();
    expect(renderRulesetProposal("a/b", null, "assisted-only")).toBeNull();
  });

  it("a blocked repo gets a proposal even with no assessed tier", () => {
    expect(renderRulesetProposal("a/b", null, "blocked")).not.toBeNull();
  });
});
