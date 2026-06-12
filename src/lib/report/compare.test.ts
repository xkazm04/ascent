import { describe, it, expect } from "vitest";
import { diffScans, matchRecommendations } from "./compare";
import type { ComparableDimension, ComparableScan } from "@/lib/db/scans";
import { DIMENSIONS } from "@/lib/maturity/model";

/** All 8 dimensions at a baseline score, with per-dimension score/signal/gap/evidence overrides. */
function dims(
  overrides: Record<
    string,
    { score?: number; signalScore?: number; gaps?: string[]; evidence?: string[] }
  > = {},
): ComparableDimension[] {
  return DIMENSIONS.map((d) => {
    const o = overrides[d.id];
    const score = o?.score ?? 50;
    return {
      dimId: d.id,
      name: d.name,
      score,
      // Signal score defaults to the blended score (they coincide unless overridden).
      signalScore: o?.signalScore ?? score,
      evidence: o?.evidence ?? [],
      gaps: o?.gaps ?? [],
    };
  });
}

function mkScan(p: Partial<ComparableScan> & { id: string }): ComparableScan {
  return {
    id: p.id,
    scannedAt: p.scannedAt ?? "2026-01-01T00:00:00.000Z",
    overallScore: p.overallScore ?? 50,
    level: p.level ?? "L3",
    levelName: p.levelName ?? "Augmented",
    archetype: p.archetype ?? "org",
    adoptionScore: p.adoptionScore ?? 50,
    rigorScore: p.rigorScore ?? 50,
    posture: p.posture ?? "",
    confidence: p.confidence ?? 0.8,
    engineProvider: p.engineProvider ?? "mock",
    headSha: p.headSha ?? null,
    dimensions: p.dimensions ?? dims(),
    recommendations: p.recommendations ?? [],
  };
}

describe("diffScans", () => {
  it("computes deltas, transitions, gap movement, and recs moved to done", () => {
    const before = mkScan({
      id: "a",
      overallScore: 40,
      level: "L2",
      levelName: "Assisted",
      adoptionScore: 30, // < 50 → manual posture (rigor high, adoption low)
      rigorScore: 60,
      dimensions: dims({
        D1: { score: 30, gaps: ["No CLAUDE.md", "No MCP config"] },
        D2: { score: 40, evidence: ["Found 6 test files", "Test framework configured"] },
      }),
      recommendations: [{ id: "r1", title: "Add tests", dimId: "D2", status: "open" }],
    });
    const after = mkScan({
      id: "b",
      overallScore: 52,
      level: "L3",
      levelName: "Augmented",
      adoptionScore: 55, // ≥ 50 → ai-native posture now
      rigorScore: 60,
      dimensions: dims({
        D1: { score: 48, gaps: ["No MCP config", "Stale agent guide"] },
        D2: {
          score: 52,
          evidence: ["Found 18 test files", "Test framework configured", "Coverage tracking configured"],
        },
      }),
      // Same dim+title as r1 but a fresh row id — matched by dim::title, not id.
      recommendations: [{ id: "r1-new", title: "Add tests", dimId: "D2", status: "done" }],
    });

    const diff = diffScans(before, after);

    expect(diff.overall.delta).toBe(12);
    expect(diff.unchanged).toBe(false);

    expect(diff.level.changed).toBe(true);
    expect(diff.level.up).toBe(true);
    expect(diff.level.before.id).toBe("L2");
    expect(diff.level.after.id).toBe("L3");

    expect(diff.adoption.delta).toBe(25);
    expect(diff.posture.changed).toBe(true);
    expect(diff.posture.before.id).toBe("manual");
    expect(diff.posture.after.id).toBe("ai-native");

    const d1 = diff.dimensions.find((d) => d.id === "D1")!;
    expect(d1.before).toBe(30);
    expect(d1.after).toBe(48);
    expect(d1.delta).toBe(18);
    expect(d1.closedGaps).toEqual(["No CLAUDE.md"]); // gone in `after`
    expect(d1.openedGaps).toEqual(["Stale agent guide"]); // new in `after`; "No MCP config" persists
    expect(diff.closedGapCount).toBe(1);
    expect(diff.openedGapCount).toBe(1);

    // Signal-level attribution: D2's +12 is tied to the concrete evidence that moved.
    const d2 = diff.dimensions.find((d) => d.id === "D2")!;
    expect(d2.delta).toBe(12);
    expect(d2.signalDelta).toBe(12);
    expect(d2.appearedSignals).toEqual(["Found 18 test files", "Coverage tracking configured"]);
    expect(d2.disappearedSignals).toEqual(["Found 6 test files"]); // "Test framework configured" persists
    expect(d2.attribution).toBe(
      "D2 +12: Found 18 test files; Coverage tracking configured; removed Found 6 test files",
    );
    expect(diff.appearedSignalCount).toBe(2);
    expect(diff.disappearedSignalCount).toBe(1);

    // The explained-movement headline lists moved dimensions, biggest swing first (D1 +18, D2 +12).
    expect(diff.movements[0].startsWith("D1 +18")).toBe(true);
    expect(diff.movements.some((m) => m.startsWith("D2 +12"))).toBe(true);

    expect(diff.recsMovedToDone).toHaveLength(1);
    expect(diff.recsMovedToDone[0]).toMatchObject({ title: "Add tests", dimId: "D2" });
  });

  it("flags identical scans as unchanged with zero movement", () => {
    const base = mkScan({
      id: "x",
      dimensions: dims({ D1: { gaps: ["a gap"] } }),
      recommendations: [{ id: "r", title: "t", dimId: "D2", status: "open" }],
    });
    const diff = diffScans(base, { ...base, id: "y" });

    expect(diff.unchanged).toBe(true);
    expect(diff.overall.delta).toBe(0);
    expect(diff.level.changed).toBe(false);
    expect(diff.posture.changed).toBe(false);
    expect(diff.closedGapCount).toBe(0);
    expect(diff.openedGapCount).toBe(0);
    expect(diff.recsMovedToDone).toHaveLength(0);
  });

  it("does not invent a delta when a dimension is absent from one scan", () => {
    const before = mkScan({ id: "a", dimensions: dims().filter((d) => d.dimId !== "D8") });
    const after = mkScan({ id: "b", dimensions: dims({ D8: { score: 70 } }) });
    const diff = diffScans(before, after);

    const d8 = diff.dimensions.find((d) => d.id === "D8")!;
    expect(d8.before).toBeNull();
    expect(d8.after).toBe(70);
    expect(d8.delta).toBeNull(); // present on only one side → no fabricated change
    expect(d8.signalDelta).toBeNull();
    expect(d8.closedGaps).toEqual([]);
    expect(d8.openedGaps).toEqual([]);
    expect(d8.appearedSignals).toEqual([]); // no signal movement invented from one side
    expect(d8.disappearedSignals).toEqual([]);
    expect(d8.attribution).toBeNull();
  });
});

describe("matchRecommendations", () => {
  it("matches exact dimension + title (tier 1)", () => {
    const prev = [{ dim: "D2", title: "Add tests" }, { dim: "D5", title: "Write docs" }];
    const next = [{ dim: "D5", title: "Write docs" }, { dim: "D2", title: "Add tests" }];
    expect(matchRecommendations(prev, next)).toEqual([1, 0]);
  });

  it("matches a rephrased title within the dimension (tier 2: case/punctuation/whitespace)", () => {
    const prev = [{ dim: "D1", title: "Agent guidance is thin — agents have little to go on" }];
    const next = [{ dim: "D1", title: "Agent guidance is thin: agents have little  to go on." }];
    expect(matchRecommendations(prev, next)).toEqual([0]);
  });

  it("pairs the lone unmatched prior and next item of a dimension (tier 3 reworded gap)", () => {
    const prev = [
      { dim: "D2", title: "Add a test suite" },
      { dim: "D6", title: "Require PR review before merge" },
    ];
    const next = [
      { dim: "D6", title: "Enforce mandatory code review on every pull request" },
      { dim: "D2", title: "Add a test suite" },
    ];
    expect(matchRecommendations(prev, next)).toEqual([1, 0]);
  });

  it("leaves ambiguous same-dimension pairs unmatched rather than guessing", () => {
    const prev = [
      { dim: "D2", title: "Add unit tests" },
      { dim: "D2", title: "Add integration tests" },
    ];
    const next = [
      { dim: "D2", title: "Establish a testing culture" },
      { dim: "D2", title: "Track coverage in CI" },
    ];
    expect(matchRecommendations(prev, next)).toEqual([null, null]);
  });

  it("consumes each prior row at most once", () => {
    const prev = [{ dim: "D3", title: "Adopt AI code review" }];
    const next = [
      { dim: "D3", title: "Adopt AI code review" },
      { dim: "D3", title: "adopt ai code review!" },
    ];
    expect(matchRecommendations(prev, next)).toEqual([0, null]);
  });

  it("returns null matches for new dimensions and an empty previous scan", () => {
    expect(matchRecommendations([], [{ dim: "D1", title: "x" }])).toEqual([null]);
    expect(
      matchRecommendations([{ dim: "D4", title: "y" }], [{ dim: "D1", title: "x" }]),
    ).toEqual([null]);
  });
});
