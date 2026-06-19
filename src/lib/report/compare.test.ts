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

  it("labels a score DROP as a regression — deltas keep the sign of after − before, level/posture fall", () => {
    // Mirror image of the happy-path test: the OLDER (higher) scan is passed as `after` here is
    // NOT the case — instead `before` is the strong scan and `after` is the weakened one, so every
    // delta must read negative. This pins that the sign is never flipped: a drop is a regression.
    const before = mkScan({
      id: "strong",
      overallScore: 70,
      level: "L4",
      levelName: "Integrated",
      adoptionScore: 60, // ≥ 50 → ai-native (both axes high)
      rigorScore: 60,
      dimensions: dims({
        D1: { score: 60, gaps: ["No MCP config"] },
        D2: { score: 70, evidence: ["Found 30 test files", "Coverage tracking configured"] },
      }),
    });
    const after = mkScan({
      id: "weakened",
      overallScore: 40,
      level: "L2",
      levelName: "Assisted",
      adoptionScore: 30, // < 50 → adoption fell below threshold; rigor stays high → manual posture
      rigorScore: 60,
      dimensions: dims({
        D1: { score: 35, gaps: ["No MCP config", "CLAUDE.md deleted"] }, // lost ground
        D2: { score: 48, evidence: ["Found 30 test files"] }, // coverage signal disappeared
      }),
    });

    const diff = diffScans(before, after);

    // Overall + axis deltas carry the real (negative) sign — not abs, not flipped.
    expect(diff.overall.delta).toBe(-30);
    expect(diff.adoption.delta).toBe(-30);
    expect(diff.rigor.delta).toBe(0);
    expect(diff.unchanged).toBe(false);

    // Level fell: changed but NOT up.
    expect(diff.level.changed).toBe(true);
    expect(diff.level.up).toBe(false);
    expect(diff.level.before.id).toBe("L4");
    expect(diff.level.after.id).toBe("L2");

    // Posture regressed from ai-native (both high) to manual (adoption dropped below threshold).
    expect(diff.posture.changed).toBe(true);
    expect(diff.posture.before.id).toBe("ai-native");
    expect(diff.posture.after.id).toBe("manual");

    // Per-dimension deltas are negative regressions; a newly opened gap and a disappeared signal.
    const d1 = diff.dimensions.find((d) => d.id === "D1")!;
    expect(d1.delta).toBe(-25); // 35 − 60, sign preserved
    expect(d1.openedGaps).toEqual(["CLAUDE.md deleted"]); // new gap = regression
    expect(d1.closedGaps).toEqual([]);

    const d2 = diff.dimensions.find((d) => d.id === "D2")!;
    expect(d2.delta).toBe(-22); // 48 − 70
    expect(d2.signalDelta).toBe(-22);
    expect(d2.disappearedSignals).toEqual(["Coverage tracking configured"]); // signal lost
    expect(d2.appearedSignals).toEqual([]);
    // The attribution line shows the negative delta and the removed evidence, not a fake gain.
    expect(d2.attribution).toBe("D2 -22: removed Coverage tracking configured");

    // Movement headline is ordered by magnitude (|−25| > |−22|) and keeps the negative signs.
    expect(diff.movements[0].startsWith("D1 -25")).toBe(true);
    expect(diff.movements.some((m) => m.startsWith("D2 -22"))).toBe(true);
  });

  it("attributes a blended-score move with no evidence change to the LLM judgment, not invented signals", () => {
    // D3's blended score moves but its signalScore AND its evidence list are identical across
    // scans → the movement came from the LLM re-judging, not a detector change. The attribution
    // must say so rather than fabricating an appeared/disappeared signal.
    const sharedEvidence = ["CI workflow present", "Branch protection configured"];
    const before = mkScan({
      id: "a",
      dimensions: dims({
        D3: { score: 50, signalScore: 50, evidence: sharedEvidence },
      }),
    });
    const after = mkScan({
      id: "b",
      dimensions: dims({
        // Blended score rose by 8 while signalScore stayed flat: pure LLM re-judgment.
        D3: { score: 58, signalScore: 50, evidence: sharedEvidence },
      }),
    });

    const diff = diffScans(before, after);
    const d3 = diff.dimensions.find((d) => d.id === "D3")!;

    expect(d3.delta).toBe(8); // blended score moved
    expect(d3.signalDelta).toBe(0); // deterministic evidence did NOT
    expect(d3.appearedSignals).toEqual([]); // no invented signals
    expect(d3.disappearedSignals).toEqual([]);
    // signalDelta === 0 → the "assessment shifted" wording, not the signal-score branch.
    expect(d3.attribution).toBe("D3 +8: assessment shifted (no change in detected signals)");

    // It still surfaces in the movement headline — an LLM-driven shift is real movement.
    expect(diff.movements.some((m) => m === "D3 +8: assessment shifted (no change in detected signals)")).toBe(
      true,
    );
  });

  it("attributes a blended move backed by a signal-score shift (no named evidence) to that signal delta", () => {
    // The OTHER LLM-attribution branch: signalDelta is non-zero but no individual evidence string
    // appeared/disappeared (the signal score moved within the same named signals). The attribution
    // cites the signal-score delta — distinct from the "assessment shifted" wording above.
    const sharedEvidence = ["Type checking enabled"];
    const before = mkScan({
      id: "a",
      dimensions: dims({ D6: { score: 40, signalScore: 40, evidence: sharedEvidence } }),
    });
    const after = mkScan({
      id: "b",
      dimensions: dims({ D6: { score: 46, signalScore: 47, evidence: sharedEvidence } }),
    });

    const diff = diffScans(before, after);
    const d6 = diff.dimensions.find((d) => d.id === "D6")!;

    expect(d6.delta).toBe(6);
    expect(d6.signalDelta).toBe(7);
    expect(d6.appearedSignals).toEqual([]);
    expect(d6.disappearedSignals).toEqual([]);
    expect(d6.attribution).toBe("D6 +6: signal score +7 with no change in named evidence");
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
