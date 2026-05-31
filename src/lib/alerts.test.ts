import { describe, it, expect } from "vitest";
import { detectRegression, buildRegressionMessage, DEFAULT_THRESHOLDS } from "./alerts";
import type { ScanDiff } from "@/lib/report/compare";
import { postureFor } from "@/lib/maturity/model";

/** Build a minimal ScanDiff with the fields the detector reads. */
function diff(over: Partial<ScanDiff> = {}): ScanDiff {
  const base: ScanDiff = {
    overall: { before: 60, after: 60, delta: 0 },
    level: { before: { id: "L3", name: "Augmented" }, after: { id: "L3", name: "Augmented" }, changed: false, up: false },
    adoption: { before: 60, after: 60, delta: 0 },
    rigor: { before: 60, after: 60, delta: 0 },
    posture: { before: postureFor(60, 60), after: postureFor(60, 60), changed: false },
    dimensions: [],
    recsMovedToDone: [],
    closedGapCount: 0,
    openedGapCount: 0,
    appearedSignalCount: 0,
    disappearedSignalCount: 0,
    movements: [],
    unchanged: true,
  };
  return { ...base, ...over };
}

describe("detectRegression", () => {
  it("flags a level demotion as critical", () => {
    const v = detectRegression(
      diff({ level: { before: { id: "L4", name: "Integrated" }, after: { id: "L3", name: "Augmented" }, changed: true, up: false } }),
    );
    expect(v.regressed).toBe(true);
    expect(v.severity).toBe("critical");
    expect(v.reasons[0].code).toBe("level-demotion");
  });

  it("flags a slide into ungoverned as critical", () => {
    const v = detectRegression(
      diff({ posture: { before: postureFor(60, 60), after: postureFor(60, 30), changed: true } }),
    );
    expect(v.severity).toBe("critical");
    expect(v.reasons.some((r) => r.code === "posture-ungoverned")).toBe(true);
  });

  it("flags an overall drop past the threshold as a warning", () => {
    const v = detectRegression(diff({ overall: { before: 60, after: 52, delta: -8 } }));
    expect(v.regressed).toBe(true);
    expect(v.severity).toBe("warning");
    expect(v.reasons[0].code).toBe("overall-drop");
  });

  it("ignores a small dip below the threshold", () => {
    const v = detectRegression(diff({ overall: { before: 60, after: 58, delta: -2 } }));
    expect(v.regressed).toBe(false);
    expect(v.severity).toBeNull();
  });

  it("flags a single-dimension crater even when overall barely moves", () => {
    const v = detectRegression(
      diff({
        overall: { before: 60, after: 58, delta: -2 },
        dimensions: [
          { id: "D2", name: "Automated Testing", before: 80, after: 60, delta: -20, signalDelta: -20, closedGaps: [], openedGaps: [], appearedSignals: [], disappearedSignals: [], attribution: null },
        ],
      }),
    );
    expect(v.regressed).toBe(true);
    expect(v.reasons.some((r) => r.code === "dimension-drop")).toBe(true);
  });

  it("respects custom thresholds", () => {
    const d = diff({ overall: { before: 60, after: 57, delta: -3 } });
    expect(detectRegression(d, DEFAULT_THRESHOLDS).regressed).toBe(false);
    expect(detectRegression(d, { overallDrop: 2, dimensionDrop: 15 }).regressed).toBe(true);
  });
});

describe("buildRegressionMessage", () => {
  it("includes the reasons and the 'why' movement attributions", () => {
    const d = diff({
      level: { before: { id: "L4", name: "Integrated" }, after: { id: "L3", name: "Augmented" }, changed: true, up: false },
      movements: ["D2 -20: removed Coverage tracking configured"],
    });
    const v = detectRegression(d);
    const msg = buildRegressionMessage({ fullName: "acme/api", url: "https://x/report" }, d, v);
    expect(msg.text).toContain("acme/api regressed");
    expect(msg.text).toContain("L4 → L3");
    expect(msg.text).toContain("D2 -20");
    expect(msg.text).toContain("https://x/report");
    expect(Array.isArray(msg.blocks)).toBe(true);
  });
});
