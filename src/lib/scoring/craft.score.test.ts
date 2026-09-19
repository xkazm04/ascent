// CRAFT NEVER TOUCHES A SCORE. The one invariant the craft ladder cannot be allowed to lose.
//
// r12 made craft entries DISPATCHABLE — the loop arms a craft lane, an agent works it, the ledger
// counts it. Every one of those is a new place a well-meaning future edit could let craft pay for
// something: a bonus for a completed rung, a tiebreak, a "craft coverage" term in a dimension. The
// moment it does, the loop optimises for the odometer instead of the craft, and the property that
// makes craft safe to propose freely — that it is never a fault and costs the repository nothing —
// is gone.
//
// So the assertion is deliberately blunt and end-to-end: assemble the SAME report twice, once with
// no craft entries and once with a full ladder of them across every axis, and demand every number
// match. Not "close" — identical.

import { describe, it, expect } from "vitest";
import { assembleReport } from "./engine";
import { CRAFT_AXES } from "./craft";
import { DIMENSIONS } from "@/lib/maturity/model";
import { MockProvider } from "@/lib/llm/mock";
import type { DimensionSignals, LlmAssessment, LlmRoadmapItem, RepoSnapshot } from "@/lib/types";

function snap(): RepoSnapshot {
  return {
    meta: { owner: "acme", name: "widget", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree: [],
    files: [],
    commits: [],
    truncated: false,
    coverage: 1,
  };
}

/** Every dimension green — the state where craft is the ONLY work left, i.e. exactly where r12 acts. */
function greenSignals(): DimensionSignals[] {
  return DIMENSIONS.map((d) => ({ id: d.id, signalScore: 92, signals: [{ label: `${d.id} signal` }] }));
}

function assessment(roadmap: LlmRoadmapItem[]): LlmAssessment {
  return {
    dimensions: DIMENSIONS.map((d) => ({
      id: d.id,
      score: 92,
      summary: "",
      strengths: [],
      gaps: [],
    })),
    headline: "",
    strengths: [],
    risks: [],
    roadmap,
    discrepancies: [],
  };
}

/** One craft rung per axis, spread over the dimensions — a maximal ladder. */
const CRAFT_LADDER: LlmRoadmapItem[] = CRAFT_AXES.map((axis, i) => ({
  title: `Raise the ${axis} ceiling`,
  dimension: DIMENSIONS[i % DIMENSIONS.length]!.id,
  impact: "medium" as const,
  effort: "medium" as const,
  rationale: "The practice is present; this is the next rung.",
  explore: ["What would fail first?"],
  kind: "craft" as const,
  craftAxis: axis,
}));

describe("craft never enters a score, a level, or a projected gain", () => {
  const mock = new MockProvider();
  const signals = greenSignals();

  const without = assembleReport(snap(), signals, assessment([]), mock, "2026-01-01T00:00:00Z", "org");
  const withCraft = assembleReport(snap(), signals, assessment(CRAFT_LADDER), mock, "2026-01-01T00:00:00Z", "org");

  it("a full craft ladder leaves the overall score and level untouched", () => {
    expect(withCraft.overallScore).toBe(without.overallScore);
    expect(withCraft.level.id).toBe(without.level.id);
  });

  it("a full craft ladder leaves every DIMENSION score untouched", () => {
    const byId = (r: typeof without) => Object.fromEntries(r.dimensions.map((d) => [d.id, d.score]));
    expect(byId(withCraft)).toEqual(byId(without));
  });

  it("a full craft ladder leaves the adoption / rigor axes untouched", () => {
    expect(withCraft.adoptionScore).toBe(without.adoptionScore);
    expect(withCraft.rigorScore).toBe(without.rigorScore);
  });

  it("the craft entries DO reach the roadmap — this is dispatchable work, not a discarded field", () => {
    // The negative assertions above are only meaningful if the entries actually survived the pipeline.
    const craft = withCraft.roadmap.filter((r) => r.kind === "craft");
    expect(craft.length).toBeGreaterThan(0);
    expect(craft.every((r) => r.craftAxis != null)).toBe(true);
  });

  it("craft entries never carry a levelUnlock — a rung above the band unlocks nothing", () => {
    // A levelUnlock is a score claim in prose. The model may emit one; the ladder must not depend on
    // it, and nothing downstream may price it.
    for (const r of withCraft.roadmap.filter((x) => x.kind === "craft")) {
      expect(r.levelUnlock ?? null).toBeNull();
    }
  });
});
