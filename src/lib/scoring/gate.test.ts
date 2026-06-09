// The security gate (`?security=1` / `?min_security=N`) is a CI enforcement boundary — lock its policy
// parsing and evaluation: a D9 (Security) floor plus a forbidden "ungoverned" posture.

import { describe, it, expect } from "vitest";
import { policyFromParams, evaluateGate, DEFAULT_SECURITY_MIN } from "./gate";
import type { DimensionResult, ScanReport } from "@/lib/types";

function report(o: { d9: number; posture?: string; level?: string; overall?: number }): ScanReport {
  const dimensions: Pick<DimensionResult, "id" | "name" | "score">[] = [
    { id: "D9", name: "Supply Chain & Security", score: o.d9 },
    { id: "D1", name: "Foundations", score: 80 },
  ];
  return {
    archetype: "org",
    level: { id: o.level ?? "L4" },
    overallScore: o.overall ?? 70,
    dimensions,
    posture: { id: o.posture ?? "ai-native", label: o.posture ?? "AI-native" },
  } as unknown as ScanReport;
}

describe("security gate", () => {
  it("?security=1 sets a D9 floor at the default and forbids the ungoverned posture", () => {
    const pol = policyFromParams(new URLSearchParams("security=1"), "org");
    expect(pol.minDimensionFor?.D9).toBe(DEFAULT_SECURITY_MIN);
    expect(pol.forbidPostures).toContain("ungoverned");
  });

  it("?min_security=70 sets an explicit D9 floor", () => {
    const pol = policyFromParams(new URLSearchParams("min_security=70"), "org");
    expect(pol.minDimensionFor?.D9).toBe(70);
  });

  it("fails a report whose Security (D9) is below the floor (but above the generic minDimension)", () => {
    const pol = policyFromParams(new URLSearchParams("security=1"), "org");
    const res = evaluateGate(report({ d9: 45 }), pol); // 45 >= 40 (minDimension) but < 50 (security floor)
    expect(res.pass).toBe(false);
    expect(res.failures.some((f) => f.code === "dimension" && f.message.includes("D9"))).toBe(true);
  });

  it("passes when D9 meets the floor and the posture is allowed", () => {
    const pol = policyFromParams(new URLSearchParams("security=1"), "org");
    expect(evaluateGate(report({ d9: 60 }), pol).pass).toBe(true);
  });

  it("fails an ungoverned posture under the security gate", () => {
    const pol = policyFromParams(new URLSearchParams("security=1"), "org");
    const res = evaluateGate(report({ d9: 80, posture: "ungoverned" }), pol);
    expect(res.failures.some((f) => f.code === "posture")).toBe(true);
  });
});
