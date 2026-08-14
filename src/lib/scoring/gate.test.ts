// The security gate (`?security=1` / `?min_security=N`) is a CI enforcement boundary — lock its policy
// parsing and evaluation: a D9 (Security) floor plus a forbidden "ungoverned" posture.

import { describe, it, expect } from "vitest";
import {
  policyFromParams,
  explicitPolicyFromParams,
  tightenGatePolicy,
  evaluateGate,
  evaluateGateLite,
  sanitizeGatePolicy,
  defaultGatePolicy,
  describeGatePolicy,
  DEFAULT_SECURITY_MIN,
} from "./gate";
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

// The tighten-only overlay the unauthenticated gate endpoint uses so a query param can raise but
// never lower a persisted org policy (ambiguity-ui 2026-07-16 ci-gate #1). explicitPolicyFromParams
// carries ONLY what the URL requests (no archetype padding); tightenGatePolicy keeps the strictest
// of each field.
describe("explicitPolicyFromParams + tightenGatePolicy (ci-gate 2026-07-16 #1)", () => {
  it("explicitPolicyFromParams returns ONLY the requested fields — no archetype defaults", () => {
    expect(explicitPolicyFromParams(new URLSearchParams(""))).toEqual({});
    expect(explicitPolicyFromParams(new URLSearchParams("min_overall=60"))).toEqual({ minOverall: 60 });
    expect(explicitPolicyFromParams(new URLSearchParams("security=1"))).toEqual({
      minDimensionFor: { D9: DEFAULT_SECURITY_MIN },
      forbidPostures: ["ungoverned"],
    });
  });

  it("policyFromParams still pads unset fields with the archetype default (unchanged contract)", () => {
    expect(policyFromParams(new URLSearchParams("min_overall=60"), "org")).toEqual({
      ...defaultGatePolicy("org"),
      minOverall: 60,
    });
  });

  it("a param can NOT weaken the org policy — the stricter org floor survives", () => {
    const org: GatePolicy = { minOverall: 70, minDimensionFor: { D9: 70 }, requireProtectedBranch: true };
    const merged = tightenGatePolicy(org, explicitPolicyFromParams(new URLSearchParams("min_overall=10")));
    expect(merged).toEqual(org); // ?min_overall=10 < 70 → dropped; D9 floor + protection rule survive
  });

  it("a param CAN tighten the org policy — the stricter param wins per-field", () => {
    const org: GatePolicy = { minLevel: "L2", minOverall: 50, minDimensionFor: { D9: 40 } };
    const merged = tightenGatePolicy(
      org,
      explicitPolicyFromParams(new URLSearchParams("min_overall=90&min_level=L4&min_security=60")),
    );
    expect(merged).toEqual({
      minLevel: "L4",
      minOverall: 90,
      minDimensionFor: { D9: 60 },
      forbidPostures: ["ungoverned"], // min_security implies the security posture rule (additive = tighter)
    });
  });

  it("fields only one side sets are kept (union, never dropped)", () => {
    const merged = tightenGatePolicy(
      { minDimension: 40, forbidPostures: ["ungoverned"] },
      { minLevel: "L3", requireProtectedBranch: true },
    );
    expect(merged).toEqual({
      minLevel: "L3",
      minDimension: 40,
      forbidPostures: ["ungoverned"],
      requireProtectedBranch: true,
    });
  });

  it("does not pad archetype defaults into the merge (a deliberately-relaxed org bar stays relaxed)", () => {
    // Org set ONLY a level bar below the org-archetype default; a min_overall param must not smuggle
    // the archetype's minDimension/forbidPostures back in.
    const merged = tightenGatePolicy({ minLevel: "L2" }, explicitPolicyFromParams(new URLSearchParams("min_overall=60")));
    expect(merged).toEqual({ minLevel: "L2", minOverall: 60 });
  });
});

// Fail-closed must cover EVERY criterion (ambiguity-ui 2026-07-16 ci-gate #2): before this fix a
// NaN overallScore or a malformed level id sailed past minOverall/minLevel in evaluateGate
// (`NaN < 40 === false`) while evaluateGateLite parsed the same level as 0 and failed it — the two
// evaluators disagreeing on the exact input the fail-closed doctrine targets.
describe("fail-closed minOverall / minLevel — both evaluators agree (ci-gate 2026-07-16 #2)", () => {
  const liteSnap = (o: { level?: string; overall?: number }) => ({
    level: o.level ?? "L4",
    overall: o.overall ?? 70,
    posture: "ai-native",
    dims: [{ dimId: "D1", score: 80 }],
  });

  it("evaluateGate: a NaN overallScore FAILS minOverall (was a silent pass)", () => {
    const res = evaluateGate(report({ d9: 80, overall: NaN }), { minOverall: 40 });
    expect(res.pass).toBe(false);
    expect(res.failures.some((f) => f.code === "overall" && /unscored/i.test(f.message))).toBe(true);
  });

  it("evaluateGate: a malformed level id FAILS minLevel (was a silent pass)", () => {
    const res = evaluateGate(report({ d9: 80, level: "Lx" }), { minLevel: "L3" });
    expect(res.pass).toBe(false);
    expect(res.failures.some((f) => f.code === "level" && /unscored/i.test(f.message))).toBe(true);
  });

  it("evaluateGateLite: a NaN overall FAILS minOverall the same way", () => {
    const res = evaluateGateLite(liteSnap({ overall: NaN }), { minOverall: 40 });
    expect(res.pass).toBe(false);
    expect(res.failures.some((f) => f.code === "overall" && /unscored/i.test(f.message))).toBe(true);
  });

  it("evaluateGateLite: a malformed level FAILS minLevel the same way", () => {
    const res = evaluateGateLite(liteSnap({ level: "Lx" }), { minLevel: "L3" });
    expect(res.pass).toBe(false);
    expect(res.failures.some((f) => f.code === "level" && /unscored/i.test(f.message))).toBe(true);
  });

  it("healthy scores are untouched: a finite overall/level still passes/fails on the plain comparison", () => {
    expect(evaluateGate(report({ d9: 80, overall: 70, level: "L4" }), { minOverall: 40, minLevel: "L3" }).pass).toBe(true);
    const res = evaluateGate(report({ d9: 80, overall: 30, level: "L2" }), { minOverall: 40, minLevel: "L3" });
    expect(res.failures.map((f) => f.code).sort()).toEqual(["level", "overall"]);
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

// ---------------------------------------------------------------------------
// An INCOMPLETE scan is not a verdict (G3-10).
//
// When every detector fails, `dimensions` is empty and overallScore/level are the renormalized floor
// (0 / L1) — indistinguishable, numerically, from a genuinely manual repo. The gate reads numbers, so
// it must read the structured flag and fail closed with one honest reason instead of certifying (or
// condemning) a repository on an ingestion failure.
// ---------------------------------------------------------------------------

describe("evaluateGate — incomplete scan fails closed (G3-10)", () => {
  const incomplete = (over: Partial<ScanReport> = {}) =>
    ({
      archetype: "org",
      level: { id: "L1" },
      overallScore: 0,
      dimensions: [],
      posture: { id: "manual", label: "Solid but Manual" },
      incomplete: true,
      ...over,
    }) as unknown as ScanReport;

  it("refuses to gate on a report flagged incomplete", () => {
    const res = evaluateGate(incomplete());
    expect(res.pass).toBe(false);
    expect(res.failures).toHaveLength(1);
    expect(res.failures[0]!.code).toBe("incomplete");
    expect(res.failures[0]!.message).toMatch(/INCOMPLETE/);
  });

  it("also catches a legacy/reconstructed report that predates the flag (empty dimensions)", () => {
    const res = evaluateGate(incomplete({ incomplete: undefined }));
    expect(res.failures.map((f) => f.code)).toEqual(["incomplete"]);
  });

  it("does not emit per-dimension noise that would read as findings about the repo", () => {
    const res = evaluateGate(incomplete(), { minOverall: 50, minDimension: 40, minLevel: "L3" });
    expect(res.failures.map((f) => f.code)).toEqual(["incomplete"]);
  });

  it("leaves a report with at least one scored dimension on the normal path", () => {
    const res = evaluateGate(report({ d9: 80 }));
    expect(res.failures.every((f) => f.code !== "incomplete")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// W2 — the ungoverned-AI-change gate. The one policy the research found described everywhere and
// productized nowhere, so its semantics are pinned here in detail.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A report carrying the PR-stats block the provenance rule reads. */
function reportWithPrStats(o: { aiGovernedRate: number | null; aiInvolvedRate?: number; analyzed?: number }): ScanReport {
  return {
    ...report({ d9: 80 }),
    prStats: {
      analyzed: o.analyzed ?? 40,
      aiInvolvedRate: o.aiInvolvedRate ?? 50,
      aiGovernedRate: o.aiGovernedRate,
    },
  } as unknown as ScanReport;
}

describe("minAiGovernedRate — the ungoverned-AI-change gate (W2)", () => {
  const strict: GatePolicy = { minAiGovernedRate: 100 };

  it("fails a repo where AI changes merged without human approval", () => {
    const g = evaluateGate(reportWithPrStats({ aiGovernedRate: 62 }), strict);
    expect(g.pass).toBe(false);
    const f = g.failures.find((x) => x.code === "provenance");
    expect(f).toBeDefined();
    expect(f!.message).toContain("62%");
    expect(f!.message).toContain("100%");
  });

  it("names the sample the rate was measured over", () => {
    // 50% of 40 analyzed PRs = 20 AI-attributed PRs.
    const g = evaluateGate(reportWithPrStats({ aiGovernedRate: 10, aiInvolvedRate: 50, analyzed: 40 }), strict);
    expect(g.failures.find((x) => x.code === "provenance")!.message).toContain("20 AI-attributed PRs sampled");
  });

  it("passes a repo where every AI change was approved", () => {
    expect(evaluateGate(reportWithPrStats({ aiGovernedRate: 100 }), strict).pass).toBe(true);
  });

  it("supports a partial bar, not just the strict form", () => {
    const pol: GatePolicy = { minAiGovernedRate: 80 };
    expect(evaluateGate(reportWithPrStats({ aiGovernedRate: 85 }), pol).pass).toBe(true);
    expect(evaluateGate(reportWithPrStats({ aiGovernedRate: 79 }), pol).pass).toBe(false);
  });

  // THE deliberate exception to this module's fail-closed discipline, and the reason it is safe:
  // every other criterion fails closed because an unscored value means the measurement BROKE. Here
  // null means the measurement was never DUE — no token, or under the engine's ≥5 AI-PR floor.
  // Failing those would block repos for having LITTLE AI activity, inverting the policy's intent.
  it("SKIPS the rule when the rate is unmeasurable, rather than failing closed", () => {
    expect(evaluateGate(reportWithPrStats({ aiGovernedRate: null }), strict).pass).toBe(true);
  });

  it("SKIPS the rule entirely when the scan carried no PR stats at all (token-less scan)", () => {
    // This is the unauthenticated /api/gate path: no token ⇒ no prStats ⇒ no provenance verdict.
    expect(evaluateGate(report({ d9: 80 }), strict).pass).toBe(true);
  });

  it("is inert when the policy does not set the bar", () => {
    expect(evaluateGate(reportWithPrStats({ aiGovernedRate: 0 }), {}).failures).toEqual([]);
  });

  it("evaluateGateLite agrees with evaluateGate — the dashboard cannot show a repo CI would block", () => {
    const snap = { level: "L4", overall: 70, posture: "ai-native", dims: [{ dimId: "D9", score: 80 }], aiGovernedRate: 62, aiPrSample: 20 };
    const lite = evaluateGateLite(snap, strict);
    const full = evaluateGate(reportWithPrStats({ aiGovernedRate: 62 }), strict);
    expect(lite.pass).toBe(full.pass);
    expect(lite.failures.find((f) => f.code === "provenance")!.message).toBe(
      full.failures.find((f) => f.code === "provenance")!.message,
    );
  });

  it("evaluateGateLite skips the rule when the rollup carries no rate", () => {
    const snap = { level: "L4", overall: 70, posture: "ai-native", dims: [{ dimId: "D9", score: 80 }] };
    expect(evaluateGateLite(snap, strict).pass).toBe(true);
  });
});

describe("minAiGovernedRate — policy plumbing", () => {
  it("?min_ai_governed=N sets the bar", () => {
    expect(explicitPolicyFromParams(new URLSearchParams("min_ai_governed=90")).minAiGovernedRate).toBe(90);
  });

  it("?no_ungoverned_ai=1 is the strict shorthand", () => {
    expect(explicitPolicyFromParams(new URLSearchParams("no_ungoverned_ai=1")).minAiGovernedRate).toBe(100);
  });

  it("an explicit value wins over the shorthand", () => {
    expect(explicitPolicyFromParams(new URLSearchParams("no_ungoverned_ai=1&min_ai_governed=80")).minAiGovernedRate).toBe(80);
  });

  // Same always-pass guard every numeric bar carries: a 0 bar looks configured and enforces nothing.
  it("drops a <=0 or >100 bar rather than installing a fake gate", () => {
    expect(explicitPolicyFromParams(new URLSearchParams("min_ai_governed=0")).minAiGovernedRate).toBeUndefined();
    expect(explicitPolicyFromParams(new URLSearchParams("min_ai_governed=150")).minAiGovernedRate).toBeUndefined();
    expect(sanitizeGatePolicy({ minAiGovernedRate: 0 })).toBeNull();
    expect(sanitizeGatePolicy({ minAiGovernedRate: 101 })).toBeNull();
  });

  it("survives the persisted-policy round trip", () => {
    expect(sanitizeGatePolicy({ minAiGovernedRate: 100 })).toEqual({ minAiGovernedRate: 100 });
  });

  // A query param may TIGHTEN the org's bar, never relax it — the unauthenticated gate endpoint
  // merges params over the persisted policy, so a PR author editing the workflow URL must not be
  // able to weaken the provenance requirement their org configured.
  it("tightens: the strictest bar wins", () => {
    expect(tightenGatePolicy({ minAiGovernedRate: 80 }, { minAiGovernedRate: 100 }).minAiGovernedRate).toBe(100);
    expect(tightenGatePolicy({ minAiGovernedRate: 100 }, { minAiGovernedRate: 50 }).minAiGovernedRate).toBe(100);
    expect(tightenGatePolicy({ minAiGovernedRate: 100 }, {}).minAiGovernedRate).toBe(100);
  });

  it("describeGatePolicy renders it into the policy text, the gate URL and the CI input", () => {
    const [c] = describeGatePolicy({ minAiGovernedRate: 100 });
    expect(c!.text).toContain("Every AI-attributed merged PR");
    expect(c!.query).toEqual(["min_ai_governed", "100"]);
    expect(c!.ci).toContain("min-ai-governed");
    // A partial bar reads as a percentage rather than as the absolute sentence.
    expect(describeGatePolicy({ minAiGovernedRate: 80 })[0]!.text).toContain("80%");
  });
});
