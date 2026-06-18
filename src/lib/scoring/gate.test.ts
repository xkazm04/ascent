// The security gate (`?security=1` / `?min_security=N`) is a CI enforcement boundary — lock its policy
// parsing and evaluation: a D9 (Security) floor plus a forbidden "ungoverned" posture.

import { describe, it, expect } from "vitest";
import { policyFromParams, evaluateGate, sanitizeGatePolicy, DEFAULT_SECURITY_MIN } from "./gate";
import type { GatePolicy } from "./gate";
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

describe("empty/zero security floor + fail-closed dimensions (CIGATE #2, #3)", () => {
  it("?min_security= (empty) does NOT request a security floor — no always-pass gate", () => {
    const pol = policyFromParams(new URLSearchParams("min_security="), "org");
    expect(pol.minDimensionFor?.D9).toBeUndefined();
  });

  it("?min_security=0 does NOT request a security floor", () => {
    const pol = policyFromParams(new URLSearchParams("min_security=0"), "org");
    expect(pol.minDimensionFor?.D9).toBeUndefined();
  });

  it("?min_security=70 still sets a real floor (a positive value IS a request)", () => {
    expect(policyFromParams(new URLSearchParams("min_security=70"), "org").minDimensionFor?.D9).toBe(70);
  });

  it("an unscored (NaN) dimension FAILS the gate fail-closed, not silently passes", () => {
    const pol = policyFromParams(new URLSearchParams("min_dimension=40"), "org");
    const res = evaluateGate(report({ d9: NaN }), pol);
    expect(res.pass).toBe(false);
    expect(res.failures.some((f) => f.code === "dimension" && f.message.includes("D9") && /unscored/i.test(f.message))).toBe(true);
  });
});

// sanitizeGatePolicy is the SINGLE boundary that turns an untrusted org gate policy (settings form /
// DB row) into a trusted GatePolicy. A regression here either silently disarms merge protection
// (a 0/absent floor stops enforcing) or hard-blocks every PR org-wide. These tests pin its REAL
// contract: clamp range 0..100 ints, reject (not clamp) out-of-range, D1..D9-only floor keys,
// "ungoverned"-only forbidPostures, and null for an empty/unusable policy.
describe("sanitizeGatePolicy", () => {
  // --- null / non-object inputs ---
  it("returns null for non-object inputs (null, string, number, array-less garbage)", () => {
    expect(sanitizeGatePolicy(null)).toBeNull();
    expect(sanitizeGatePolicy(undefined)).toBeNull();
    expect(sanitizeGatePolicy("x")).toBeNull();
    expect(sanitizeGatePolicy(42)).toBeNull();
    expect(sanitizeGatePolicy(true)).toBeNull();
  });

  it("returns null for an empty object (no usable keys) — caller falls back to archetype default", () => {
    expect(sanitizeGatePolicy({})).toBeNull();
  });

  it("returns null when every field is invalid (so no half-built policy ever escapes)", () => {
    // minLevel not a real level, scores out of range, floors keyed wrong, postures not 'ungoverned'.
    const res = sanitizeGatePolicy({
      minLevel: "L9",
      minOverall: 150,
      minDimension: -1,
      minDimensionFor: { D10: 50, evil: 50 },
      forbidPostures: ["governed", "managed"],
    });
    expect(res).toBeNull();
  });

  // --- minLevel ---
  it("keeps a valid minLevel and drops a non-existent level id", () => {
    expect(sanitizeGatePolicy({ minLevel: "L3" })).toEqual({ minLevel: "L3" });
    expect(sanitizeGatePolicy({ minLevel: "L9" })).toBeNull(); // not a real level → key absent → null
    expect(sanitizeGatePolicy({ minLevel: 3 })).toBeNull(); // wrong type → dropped
  });

  // --- score clamping (minOverall / minDimension): clampScore = finite && >=0 && <=100, then trunc ---
  it("drops out-of-range scores entirely (NOT clamped to the boundary)", () => {
    // 150 > 100 and -1 < 0 are REJECTED (key absent), not pinned to 100/0 — a wrong relaxation of
    // the range check would surface here.
    expect(sanitizeGatePolicy({ minOverall: 150 })).toBeNull();
    expect(sanitizeGatePolicy({ minOverall: -1 })).toBeNull();
    expect(sanitizeGatePolicy({ minDimension: 150 })).toBeNull();
    expect(sanitizeGatePolicy({ minDimension: -1 })).toBeNull();
  });

  it("drops NaN / non-numeric-string scores", () => {
    expect(sanitizeGatePolicy({ minOverall: NaN })).toBeNull();
    expect(sanitizeGatePolicy({ minDimension: "abc" })).toBeNull();
    expect(sanitizeGatePolicy({ minOverall: Infinity })).toBeNull();
  });

  it("coerces numeric strings and truncates fractional scores (string '40' → 40, 39.9 → 39)", () => {
    expect(sanitizeGatePolicy({ minDimension: "40" })).toEqual({ minDimension: 40 });
    expect(sanitizeGatePolicy({ minDimension: 39.9 })).toEqual({ minDimension: 39 });
    expect(sanitizeGatePolicy({ minOverall: "70.8" })).toEqual({ minOverall: 70 });
  });

  it("keeps the inclusive range boundaries 0 and 100", () => {
    expect(sanitizeGatePolicy({ minOverall: 100 })).toEqual({ minOverall: 100 });
    // TRAP (pinned as CURRENT behavior): clampScore treats 0 as a VALID floor (finite, >=0, <=100),
    // so { minDimension: 0 } survives sanitization as a real `0` floor — an always-pass dimension
    // gate that still LOOKS configured. Unlike policyFromParams (which requires min_security > 0),
    // sanitizeGatePolicy does NOT drop a 0 here. If this assertion ever needs to flip to expect a
    // dropped key, that is a DELIBERATE hardening — not a silent regression.
    expect(sanitizeGatePolicy({ minDimension: 0 })).toEqual({ minDimension: 0 });
    expect(sanitizeGatePolicy({ minOverall: 0 })).toEqual({ minOverall: 0 });
  });

  it("the 0-floor passthrough is an always-pass gate (documents the trap end-to-end)", () => {
    const pol = sanitizeGatePolicy({ minDimension: 0 }) as GatePolicy;
    // A report with the worst possible dimension score (0) still PASSES a minDimension=0 gate.
    const res = evaluateGate(
      {
        archetype: "org",
        level: { id: "L4" },
        overallScore: 70,
        dimensions: [{ id: "D9", name: "Security", score: 0 }],
        posture: { id: "ai-native", label: "AI-native" },
      } as unknown as ScanReport,
      pol,
    );
    expect(res.pass).toBe(true); // 0 is NOT below the 0 floor → no dimension failure
  });

  // --- minDimensionFor: only /^D[1-9]$/ keys, each value clampScore'd ---
  it("keeps only D1..D9 floor keys and drops D10 / arbitrary keys", () => {
    const res = sanitizeGatePolicy({ minDimensionFor: { D10: 50, evil: 50, D9: 60 } });
    expect(res).toEqual({ minDimensionFor: { D9: 60 } });
  });

  it("drops invalid floor VALUES inside minDimensionFor but keeps the valid ones", () => {
    const res = sanitizeGatePolicy({ minDimensionFor: { D1: 150, D2: "30", D3: -5, D4: 40 } });
    // D1 (>100) and D3 (<0) rejected; D2 coerced from string; D4 kept.
    expect(res).toEqual({ minDimensionFor: { D2: 30, D4: 40 } });
  });

  it("omits minDimensionFor entirely when no floor key survives", () => {
    expect(sanitizeGatePolicy({ minDimensionFor: { D10: 50, junk: 1 } })).toBeNull();
    expect(sanitizeGatePolicy({ minDimensionFor: "not-an-object" })).toBeNull();
  });

  // --- forbidPostures: keep only "ungoverned" ---
  it("keeps only the 'ungoverned' posture and drops the rest", () => {
    expect(sanitizeGatePolicy({ forbidPostures: ["governed", "ungoverned"] })).toEqual({
      forbidPostures: ["ungoverned"],
    });
  });

  it("omits forbidPostures when 'ungoverned' is absent, and when not an array", () => {
    expect(sanitizeGatePolicy({ forbidPostures: ["governed", "managed"] })).toBeNull();
    expect(sanitizeGatePolicy({ forbidPostures: "ungoverned" })).toBeNull(); // not an array → ignored
  });

  // --- passthrough / shape ---
  it("passes a fully-valid policy through unchanged", () => {
    const valid: GatePolicy = {
      minLevel: "L3",
      minOverall: 60,
      minDimension: 40,
      minDimensionFor: { D9: 70 },
      forbidPostures: ["ungoverned"],
    };
    expect(sanitizeGatePolicy({ ...valid })).toEqual(valid);
  });

  it("never emits a key the validator did not explicitly set (no extra/unknown fields leak through)", () => {
    const res = sanitizeGatePolicy({
      minDimension: 40,
      bogus: "x",
      __proto__: { polluted: true },
      enabled: true,
    }) as GatePolicy;
    expect(Object.keys(res).sort()).toEqual(["minDimension"]);
  });

  it("returns only the subset of valid keys when input is partially valid", () => {
    // minLevel valid, minOverall out of range (dropped), minDimension valid.
    expect(sanitizeGatePolicy({ minLevel: "L2", minOverall: 999, minDimension: 25 })).toEqual({
      minLevel: "L2",
      minDimension: 25,
    });
  });
});
