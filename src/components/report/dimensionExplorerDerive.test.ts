import { describe, expect, it } from "vitest";
import type { DimensionResult } from "@/lib/types";
import { dimFacts, explorerSummary, provenanceLabel } from "@/components/report/dimensionExplorerDerive";

const dim = (over: Partial<DimensionResult> & Pick<DimensionResult, "id" | "score" | "weight">): DimensionResult => ({
  name: over.id,
  signalScore: over.score,
  llmScore: over.score,
  summary: "",
  evidence: [],
  strengths: [],
  gaps: [],
  ...over,
});

describe("dimFacts", () => {
  it("routes a score through the rubric: level, next rung, weighted headroom", () => {
    const f = dimFacts(dim({ id: "D2", score: 58, weight: 0.15 }), 50);
    expect(f.level.id).toBe("L3");
    expect(f.next?.id).toBe("L4");
    expect(f.toNext).toBe(7); // L4 floor is 65
    expect(f.headroom).toBeCloseTo(0.15 * 42);
    expect(f.contributes).toBeCloseTo(0.15 * 58);
    expect(f.delta).toBe(8);
    expect(f.short).toBe("Testing");
    expect(f.axis).toBe("rigor");
  });

  it("has no next rung at the summit and no delta without a previous scan", () => {
    const f = dimFacts(dim({ id: "D1", score: 91, weight: 0.15 }), undefined);
    expect(f.level.id).toBe("L5");
    expect(f.next).toBeNull();
    expect(f.toNext).toBeNull();
    expect(f.delta).toBeNull();
  });

  it("records model-minus-detector divergence and the scoring mechanism", () => {
    const blended = dimFacts(dim({ id: "D5", score: 60, weight: 0.09, signalScore: 50, llmScore: 70 }), undefined);
    expect(blended.divergence).toBe(20);
    expect(blended.provenance.kind).toBe("blended");
    expect(provenanceLabel(blended.provenance)).toBe("blended");

    const signalOnly = dimFacts(dim({ id: "D9", score: 40, weight: 0.1 }), undefined);
    expect(signalOnly.provenance.kind).toBe("signal-only");
    expect(provenanceLabel(signalOnly.provenance)).toBe("detector battery, verbatim");

    const claim = dimFacts(dim({ id: "D4", score: 45, weight: 0.12, signalScore: 30 }), undefined);
    expect(provenanceLabel(claim.provenance)).toBe("signal + 15 verified-citation pts");
  });
});

describe("explorerSummary", () => {
  it("names the leader, the trailer and the biggest lever in one line", () => {
    const facts = [
      dimFacts(dim({ id: "D1", score: 80, weight: 0.15 }), undefined), // headroom 3.0
      dimFacts(dim({ id: "D2", score: 40, weight: 0.15 }), undefined), // headroom 9.0 — the lever
      dimFacts(dim({ id: "D6", score: 20, weight: 0.07 }), undefined), // headroom 5.6 — the trailer
    ];
    const s = explorerSummary(facts)!;
    expect(s.leader.id).toBe("D1");
    expect(s.trailer.id).toBe("D6");
    expect(s.lever.id).toBe("D2");
    expect(s.atL4).toBe(1);
    expect(s.line).toBe("AI Tooling leads at 80 · Quality trails 60 pts · biggest lever: Testing (+9.0 overall pts in reach)");
  });

  it("is null for a scan that scored nothing", () => {
    expect(explorerSummary([])).toBeNull();
  });
});
