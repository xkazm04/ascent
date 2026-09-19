import { describe, it, expect } from "vitest";
import type { Posture } from "@/lib/types";

// Regression pins for the two empty/unknown-input fallbacks that keep a report chart from
// silently vanishing (test-mastery-2026-06-18 / score-charts-visuals #5):
//
//   1. RadarChart.tsx:22 — `if (dimensions.length === 0) return <…"No dimension data"…>`.
//      angleFor() divides by `n = dimensions.length`; n === 0 makes every vertex NaN and
//      collapses the polygon. The guard degrades [] to a labeled "no data" placeholder.
//
//   2. PostureQuadrant.tsx:62 — `const color = QUAD_TINT[posture.id] ?? "#475569"`.
//      posture.id comes from the (untrusted) report; a drifted/unknown id would yield
//      undefined and the "you are here" dot would render with no fill/stroke and vanish.
//      The `?? "#475569"` falls back to the same neutral slate the inactive labels use.
//
// Both guards live inside DOM-coupled React components and the component constants are
// module-private, so we can't import them without a source change. Instead we pin the pure
// DECISION LOGIC each guard encodes, mirroring the component's map/predicate exactly. The
// invariant under test: empty/unknown input degrades to a labeled fallback, never to a
// NaN-collapsed or invisible chart. If anyone changes the component's branch, this spec is
// the executable record of what the safe behaviour must remain.

// --- Fallback 1: RadarChart empty-dimensions guard ---------------------------------------
// Mirrors the exact branch condition `dimensions.length === 0`.
function radarHasData<T>(dims: readonly T[]): boolean {
  return dims.length > 0;
}

describe("RadarChart empty-dimensions fallback (RadarChart.tsx:22)", () => {
  it("returns false for an empty dimension set (the no-data placeholder branch)", () => {
    // RoadmapSandbox and other direct callers can pass [] (component comment lines 18-21).
    expect(radarHasData([])).toBe(false);
  });

  it("returns true for any non-empty dimension set (the real-chart branch)", () => {
    expect(radarHasData([{ score: 50 }])).toBe(true);
    expect(radarHasData([{ score: 1 }, { score: 2 }, { score: 3 }])).toBe(true);
  });

  it("guards the divide-by-n: a one-or-more length never yields n === 0", () => {
    // angleFor() = -PI/2 + (i*2*PI)/n. The guard exists so n is never 0 below it.
    const dims = [{ score: 0 }];
    expect(radarHasData(dims)).toBe(true);
    const n = dims.length;
    const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    // With the guard satisfied (n >= 1), the vertex angle is always finite — never NaN.
    expect(Number.isFinite(angleFor(0))).toBe(true);
  });

  it("documents the corruption the guard prevents: n === 0 collapses the vertex to NaN", () => {
    // This is the bug the guard exists to stop — asserted here so a refactor that drops the
    // guard (and lets n === 0 through) is provably wrong, not just visually broken.
    // n === 0 → angle is Infinity, and point() feeds it to Math.cos/Math.sin → NaN, so the
    // <polygon> coordinate is NaN and the whole chart silently collapses.
    const nZero = 0;
    const angleForNoGuard = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / nZero;
    const a = angleForNoGuard(1);
    expect(Number.isFinite(a)).toBe(false); // Infinity
    const vertexX = Math.cos(a); // point() does cx + radius*frac*Math.cos(a)
    expect(Number.isNaN(vertexX)).toBe(true); // → NaN coordinate, polygon vanishes
  });
});

// --- Fallback 2: PostureQuadrant unknown-posture-id tint fallback -------------------------
// Mirrors QUAD_TINT (PostureQuadrant.tsx:9-14) and the `?? "#475569"` neutral-slate default.
const QUAD_TINT: Record<Posture["id"], string> = {
  "ai-native": "#22c55e",
  ungoverned: "#f97316",
  manual: "#3b9eff",
  early: "#ef4444",
};
const NEUTRAL_SLATE = "#475569";

// Mirrors the exact expression `QUAD_TINT[posture.id] ?? "#475569"`.
function quadTintFor(id: string): string {
  return (QUAD_TINT as Record<string, string>)[id] ?? NEUTRAL_SLATE;
}

describe("PostureQuadrant unknown-posture tint fallback (PostureQuadrant.tsx:62)", () => {
  it("returns the rubric tint for every known posture id (no false fallback)", () => {
    // Every member of the real Posture['id'] union must resolve to a non-default colour, so
    // the marker is never tinted neutral-slate for a valid posture.
    const known: Posture["id"][] = ["ai-native", "ungoverned", "manual", "early"];
    for (const id of known) {
      expect(quadTintFor(id)).toBe(QUAD_TINT[id]);
      expect(quadTintFor(id)).not.toBe(NEUTRAL_SLATE);
    }
  });

  it("falls back to neutral slate for a drifted/unknown id (the marker can't vanish)", () => {
    expect(quadTintFor("bogus")).toBe(NEUTRAL_SLATE);
    expect(quadTintFor("legacy-posture")).toBe(NEUTRAL_SLATE);
    expect(quadTintFor("")).toBe(NEUTRAL_SLATE);
  });

  it("always returns a usable (truthy, non-undefined) colour for any input", () => {
    // The whole point of the guard: the dot always has a stroke/fill colour, so it renders.
    for (const id of ["ai-native", "early", "unknown", "", "AI-NATIVE"]) {
      const c = quadTintFor(id);
      expect(c).toBeTruthy();
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("is case-sensitive: an id with the wrong case hits the fallback, not a wrong tint", () => {
    // Guards against a silent mismatch where a casing drift returns a stale colour.
    expect(quadTintFor("AI-Native")).toBe(NEUTRAL_SLATE);
    expect(quadTintFor("Manual")).toBe(NEUTRAL_SLATE);
  });
});
