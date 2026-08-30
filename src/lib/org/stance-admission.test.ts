// moonshot #8 — the two stance findings that make `advisory` a real flag and the declared review
// tier checkable. A sibling of stance.test.ts (which covers the W3 contracts) so neither file grows
// past the point where a reader can hold it.

import { describe, expect, it } from "vitest";
import { evaluateStanceCompliance, type StanceRepoFacts } from "./stance";
import type { AiStance } from "@/lib/types";

const baseStance = (over: Partial<AiStance> = {}): AiStance => ({
  permittedTools: [],
  permittedModels: [],
  noAiZones: [],
  reviewTiers: [],
  provenance: { requireTrailer: false, requireHumanApproval: false },
  ...over,
});

const facts = (over: Partial<StanceRepoFacts> = {}): StanceRepoFacts => ({
  name: "api",
  fullName: "acme/api",
  level: "L3",
  overall: 62,
  autonomyTier: "T1",
  observedTools: [],
  aiInvolvedRate: null,
  aiTrailerRate: null,
  unapprovedAiChanges: 0,
  ackedVersion: null,
  ...over,
});

describe("no-ai-zone-path — the first genuinely advisory finding", () => {
  const pathStance = () => baseStance({ noAiZones: [{ repoGlobs: [], pathGlobs: ["prisma/migrations/**"] }] });

  // FAIL-BEFORE: a stance declaring ONLY a path-scoped zone produced zero findings, so the clause
  // was invisible in the readout and `compliant: true` said nothing about it either way.
  it("emits it, and `compliant` stays true FOR THE RIGHT REASON", () => {
    const r = evaluateStanceCompliance(pathStance(), facts(), 1);

    const finding = r.findings.find((f) => f.code === "no-ai-zone-path");
    expect(finding).toBeDefined();
    expect(finding!.advisory).toBe(true);
    expect(finding!.message).toContain("prisma/migrations/**");
    // Compliant BECAUSE every finding is advisory — not because there were none. Before this the two
    // were indistinguishable, which is exactly what made `advisory` degenerate (BACKLOG group-05).
    expect(r.compliant).toBe(true);
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.every((f) => f.advisory)).toBe(true);
  });

  it("says plainly that the clause is declared, not checked", () => {
    const [f] = evaluateStanceCompliance(pathStance(), facts(), 1).findings;
    expect(f!.message).toContain("declared, not checked");
    expect(f!.message.toLowerCase()).not.toContain("enforce");
  });

  it("a repo-scoped zone alone raises no path finding", () => {
    const stance = baseStance({ noAiZones: [{ repoGlobs: ["acme/api"], pathGlobs: [] }] });
    expect(evaluateStanceCompliance(stance, facts(), 1).findings.some((f) => f.code === "no-ai-zone-path")).toBe(false);
  });

  it("dedupes paths across zones so the message counts clauses, not repetitions", () => {
    const stance = baseStance({
      noAiZones: [
        { repoGlobs: [], pathGlobs: ["infra/**"] },
        { repoGlobs: [], pathGlobs: ["infra/**"] },
      ],
    });
    expect(evaluateStanceCompliance(stance, facts(), 1).findings[0]!.message).toContain("1 declared no-AI path zone");
  });
});

describe("review-tier — declared review vs OBSERVED approvals", () => {
  const tierStance = () => baseStance({ reviewTiers: [{ tier: "T1", review: "One approval from the owner." }] });

  it("flags a declared requirement the observed branch does not carry", () => {
    const r = evaluateStanceCompliance(tierStance(), facts({ autonomyTier: "T1" }), 1, { requiredApprovals: 0 });
    const f = r.findings.find((x) => x.code === "review-tier");
    expect(f).toMatchObject({ advisory: false });
    expect(f!.message).toContain("One approval from the owner.");
    expect(r.compliant).toBe(false);
  });

  // Null is not zero. Reporting "no approval required" for a repo nobody measured would be the
  // loudest possible finding derived from the least possible evidence.
  it("SKIPS on an unobserved approval count", () => {
    for (const observed of [{}, { requiredApprovals: null }]) {
      const r = evaluateStanceCompliance(tierStance(), facts({ autonomyTier: "T1" }), 1, observed);
      expect(r.findings.some((f) => f.code === "review-tier")).toBe(false);
    }
  });

  it("SKIPS when the observed count satisfies the declaration, or the tier is unassessed", () => {
    expect(evaluateStanceCompliance(tierStance(), facts({ autonomyTier: "T1" }), 1, { requiredApprovals: 2 }).findings).toHaveLength(0);
    expect(evaluateStanceCompliance(tierStance(), facts({ autonomyTier: null }), 1, { requiredApprovals: 0 }).findings).toHaveLength(0);
  });

  it("SKIPS when the stance declares nothing for this repo's tier", () => {
    const stance = baseStance({ reviewTiers: [{ tier: "T0", review: "Two approvals." }] });
    expect(evaluateStanceCompliance(stance, facts({ autonomyTier: "T3" }), 1, { requiredApprovals: 0 }).findings).toHaveLength(0);
  });
});
