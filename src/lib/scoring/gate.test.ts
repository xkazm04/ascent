// The security gate (`?security=1` / `?min_security=N`) is a CI enforcement boundary — lock its policy
// parsing and evaluation: a D9 (Security) floor plus a forbidden "ungoverned" posture.

import { describe, it, expect } from "vitest";
import { policyFromParams, evaluateGate, sanitizeGatePolicy, defaultGatePolicy, DEFAULT_SECURITY_MIN } from "./gate";
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

// requireProtectedBranch closes Raj's gap: branch protection is folded into the dimension scores ADDITIVELY
// (absence never demotes), so a high-scoring but UNGOVERNED repo could pass on score alone. This opt-in
// criterion makes "is the default branch actually protected?" an explicit, enforceable, readable-gated bar.
describe("requireProtectedBranch (ungoverned can't pass on score alone)", () => {
  const withGov = (gov: unknown) => ({ ...report({ d9: 90, overall: 90, level: "L4" }), governance: gov }) as unknown as ScanReport;

  it("?require_protection=1 sets the policy flag (and is absent otherwise)", () => {
    expect(policyFromParams(new URLSearchParams("require_protection=1"), "org").requireProtectedBranch).toBe(true);
    expect(policyFromParams(new URLSearchParams(""), "org").requireProtectedBranch).toBeUndefined();
  });

  it("FAILS a readable but UNPROTECTED default branch even when every score is high", () => {
    const res = evaluateGate(withGov({ defaultBranch: "main", protected: false, readable: true }), { requireProtectedBranch: true });
    expect(res.pass).toBe(false);
    expect(res.failures.some((f) => f.code === "governance")).toBe(true);
  });

  it("PASSES a protected default branch", () => {
    expect(evaluateGate(withGov({ defaultBranch: "main", protected: true, readable: true }), { requireProtectedBranch: true }).pass).toBe(true);
  });

  it("does NOT false-fail when governance is unreadable or absent (no token saw the rules)", () => {
    expect(evaluateGate(withGov({ defaultBranch: "main", protected: false, readable: false }), { requireProtectedBranch: true }).pass).toBe(true);
    expect(evaluateGate(withGov(null), { requireProtectedBranch: true }).pass).toBe(true);
  });

  it("sanitizeGatePolicy keeps requireProtectedBranch:true and drops a non-true value", () => {
    expect(sanitizeGatePolicy({ requireProtectedBranch: true })).toEqual({ requireProtectedBranch: true });
    expect(sanitizeGatePolicy({ requireProtectedBranch: "yes" })).toBeNull();
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

  it("keeps the inclusive upper boundary 100 but DROPS a 0 floor (no always-pass gate)", () => {
    expect(sanitizeGatePolicy({ minOverall: 100 })).toEqual({ minOverall: 100 });
    // A floor of 0 (or negative) is an always-pass gate that still LOOKS configured. Like
    // policyFromParams (which requires min_security > 0), sanitizeGatePolicy now treats <= 0 as
    // "not set" and DROPS the key — so a 0-only policy is empty → null, no real 0 floor survives.
    expect(sanitizeGatePolicy({ minDimension: 0 })).toBeNull();
    expect(sanitizeGatePolicy({ minOverall: 0 })).toBeNull();
  });

  it("a dropped 0 floor leaves no dimension gate (the always-pass trap is closed)", () => {
    // { minDimension: 0 } no longer survives — the only key is dropped, so the policy is null and
    // there is no dimension floor to (vacuously) pass. A real floor must be a positive number.
    expect(sanitizeGatePolicy({ minDimension: 0 })).toBeNull();
    // A 0-valued per-dimension floor is likewise dropped, leaving no minDimensionFor.
    expect(sanitizeGatePolicy({ minDimensionFor: { D9: 0 } })).toBeNull();
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

// policyFromParams turns an UNTRUSTED query string (the user-authored badge/CI URL) into a GatePolicy,
// falling back to the archetype default for anything unset. These cases pin its overload-resolution
// contract for the `min_overall` / `min_dimension` thresholds:
//   - a param sets the floor ONLY when `Number(value)` is finite AND `params.get(key) != null`;
//   - a non-numeric / NaN / absent value is IGNORED → the archetype default survives;
//   - a finite POSITIVE value IS honored as the floor; a <=0 / empty value falls back to the default.
// CONTRACT: min_overall / min_dimension now require a strictly POSITIVE floor — consistent with
//   min_security's `> 0` rule and sanitizeGatePolicy's `<= 0` drop. `?min_dimension=0` and
//   `?min_dimension=` (→ `Number("")===0`) would otherwise install an always-pass 0 floor that
//   silently disarms the CI gate via a query param, so a <=0 value falls back to the archetype
//   default rather than weakening the gate.
describe("policyFromParams — min_overall / min_dimension threshold parsing", () => {
  const ORG_DEFAULT = defaultGatePolicy("org"); // { minLevel: "L3", minDimension: 40, forbidPostures: ["ungoverned"] }

  // --- a finite POSITIVE value sets the floor (the only unambiguous "request") ---
  it("?min_dimension=50 sets a positive minDimension floor", () => {
    expect(policyFromParams(new URLSearchParams("min_dimension=50"), "org").minDimension).toBe(50);
  });

  it("?min_overall=55 sets a positive minOverall floor", () => {
    expect(policyFromParams(new URLSearchParams("min_overall=55"), "org").minOverall).toBe(55);
  });

  // --- absent / non-numeric / NaN values are IGNORED → archetype default survives ---
  it("an absent min_dimension param keeps the archetype default floor (not 0)", () => {
    // No min_dimension in the query → params.get() === null → default 40 used.
    expect(policyFromParams(new URLSearchParams("min_overall=55"), "org").minDimension).toBe(
      ORG_DEFAULT.minDimension,
    );
  });

  it("a non-numeric min_dimension is ignored and falls back to the archetype default", () => {
    expect(policyFromParams(new URLSearchParams("min_dimension=abc"), "org").minDimension).toBe(
      ORG_DEFAULT.minDimension,
    );
  });

  it("an explicit NaN string for min_dimension is ignored (Number('NaN') is not finite)", () => {
    expect(policyFromParams(new URLSearchParams("min_dimension=NaN"), "org").minDimension).toBe(
      ORG_DEFAULT.minDimension,
    );
  });

  it("an absent min_overall param leaves minOverall unset (org default has none)", () => {
    // The org archetype default carries no minOverall, so an unset param must not invent one.
    expect(policyFromParams(new URLSearchParams("min_dimension=50"), "org").minOverall).toBeUndefined();
  });

  // --- 0 / empty-value behavior: a <=0 floor is REJECTED and falls back to the archetype default ---
  // (consistent with min_security / sanitizeGatePolicy) so a query param can't silently disarm the gate.
  it("?min_dimension=0 is rejected (<=0) and falls back to the archetype default floor", () => {
    expect(policyFromParams(new URLSearchParams("min_dimension=0"), "org").minDimension).toBe(
      ORG_DEFAULT.minDimension,
    );
  });

  it("?min_dimension= (empty → Number('')===0) falls back to the archetype default", () => {
    expect(policyFromParams(new URLSearchParams("min_dimension="), "org").minDimension).toBe(
      ORG_DEFAULT.minDimension,
    );
  });

  it("?min_overall=0 is rejected and leaves minOverall at the archetype default (org has none)", () => {
    expect(policyFromParams(new URLSearchParams("min_overall=0"), "org").minOverall).toBe(ORG_DEFAULT.minOverall);
  });

  it("?min_overall= (empty) falls back to the archetype default (unset for org)", () => {
    expect(policyFromParams(new URLSearchParams("min_overall="), "org").minOverall).toBe(ORG_DEFAULT.minOverall);
  });

  it("a 0 minDimension param falls back to the default floor (NOT an always-pass gate)", () => {
    // With the <=0 guard, ?min_dimension=0 -> the org default floor (40), so the worst-scoring
    // dimension (0) IS below the floor and fails - the gate can't be disarmed via the query param.
    const pol = policyFromParams(new URLSearchParams("min_dimension=0"), "org");
    const res = evaluateGate(report({ d9: 0 }), pol);
    expect(res.failures.some((f) => f.code === "dimension")).toBe(true);
  });

  it("a 0 minOverall param falls back to the org default (no overall floor) -> no 'overall' failure", () => {
    // The org archetype carries no minOverall, so a rejected 0 leaves it unset -> no overall floor at all.
    const pol = policyFromParams(new URLSearchParams("min_overall=0"), "org");
    const res = evaluateGate(report({ d9: 80, overall: 0 }), pol);
    expect(res.failures.some((f) => f.code === "overall")).toBe(false);
  });

  // --- out-of-range / fractional floors now share sanitizeGatePolicy's contract (>100 dropped, truncated) ---
  it("?min_overall=150 is out of range (>100) -> falls back to the default, not an unreachable always-fail floor", () => {
    expect(policyFromParams(new URLSearchParams("min_overall=150"), "org").minOverall).toBe(ORG_DEFAULT.minOverall);
  });

  it("?min_dimension=999 is out of range (>100) -> falls back to the archetype default floor", () => {
    expect(policyFromParams(new URLSearchParams("min_dimension=999"), "org").minDimension).toBe(ORG_DEFAULT.minDimension);
  });

  it("?min_security=999 is out of range (>100) -> dropped, security gate uses DEFAULT_SECURITY_MIN", () => {
    const pol = policyFromParams(new URLSearchParams("security=1&min_security=999"), "org");
    expect(pol.minDimensionFor?.D9).toBe(DEFAULT_SECURITY_MIN);
  });

  it("?min_dimension=39.9 is truncated to an int floor (parity with sanitizeGatePolicy)", () => {
    expect(policyFromParams(new URLSearchParams("min_dimension=39.9"), "org").minDimension).toBe(39);
  });
});
