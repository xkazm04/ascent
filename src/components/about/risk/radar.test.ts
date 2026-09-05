import { describe, expect, it } from "vitest";
import { BLIPS, deriveGateState } from "./radar";

// G6-25: the risk-radar animation must never claim "Gate Pass" in the same frame the "open risks"
// metric is nonzero. One blip is deliberately placed beyond WAVE_MAX (non-critical, never mitigated)
// so a naive `criticalOpen === 0` gate flips to "pass" while that blip still counts as an open risk.
describe("deriveGateState", () => {
  it("never returns pass while risks are still open", () => {
    for (let openRisks = 0; openRisks <= 3; openRisks++) {
      for (let criticalOpen = 0; criticalOpen <= 3; criticalOpen++) {
        const gate = deriveGateState(5, criticalOpen, openRisks);
        if (gate === "pass") {
          expect(openRisks).toBe(0);
        }
      }
    }
  });

  it("reports scan before anything is detected", () => {
    expect(deriveGateState(0, 0, 0)).toBe("scan");
  });

  it("reports fail whenever a critical risk is open, regardless of total open risks", () => {
    expect(deriveGateState(5, 1, 1)).toBe("fail");
    expect(deriveGateState(5, 2, 5)).toBe("fail");
  });

  it("reports clear (not pass) when only a non-critical risk lingers", () => {
    expect(deriveGateState(5, 0, 1)).toBe("clear");
  });

  it("reports pass only when detection has started and nothing is open", () => {
    expect(deriveGateState(5, 0, 0)).toBe("pass");
  });

  it("regression: the real BLIPS dataset has exactly one permanently-open, non-critical risk", () => {
    // Once every blip has been detected and every mitigable one has resolved, the composition's
    // real fixture data must land in "clear", never "pass" — this is the exact scenario G6-25
    // reported (radar.ts:13,30 — a blip past WAVE_MAX that is never mitigated).
    const allDetected = BLIPS.length;
    const criticalOpen = 0; // all critical blips are within WAVE_MAX and eventually mitigate
    const openRisks = BLIPS.filter((b) => !Number.isFinite(b.mitigate)).length;
    expect(openRisks).toBe(1);
    expect(deriveGateState(allDetected, criticalOpen, openRisks)).toBe("clear");
  });
});
