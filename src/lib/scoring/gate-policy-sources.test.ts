// W4-O / moonshot #8 + #16 — the policy-SOURCE contract from docs/resolutions/gate-as-code.md.
//
// Three things are locked here, and each exists because breaking it costs the property the gate is
// built on ("a caller can tighten a bar, never weaken it"):
//
//  1. THE FOUR-PLACE GUARD (structural, table-driven). Every `GatePolicy` field must survive
//     `sanitizeGatePolicy`, be merged strictest-wins by `tightenGatePolicy`, and render a condition
//     in `describeGatePolicy`. A field added without its four places is how a bar becomes decorative,
//     which is exactly what defect D10 (`policyFromParams` dropping `minAiGovernedRate`) was.
//  2. `forbidAiAuthorship` (#8) — the admission fragment's only gate-visible field, fail-OPEN when
//     AI activity is unmeasurable.
//  3. `requireChecks` (#16) — union-merged, with the three honest-null skips.

import { describe, it, expect } from "vitest";
import {
  describeGatePolicy,
  evaluateGate,
  evaluateGateLite,
  explicitPolicyFromParams,
  policyFromParams,
  sanitizeGatePolicy,
  tightenGatePolicy,
  type GatePolicy,
} from "./gate";
import type { DimensionResult, ScanReport } from "@/lib/types";

function report(o: { aiInvolvedRate?: number; analyzed?: number; aiGovernedRate?: number } = {}): ScanReport {
  const dimensions: Pick<DimensionResult, "id" | "name" | "score">[] = [
    { id: "D9", name: "Supply Chain & Security", score: 80 },
    { id: "D1", name: "Foundations", score: 80 },
  ];
  return {
    archetype: "org",
    level: { id: "L4" },
    overallScore: 70,
    dimensions,
    posture: { id: "ai-native", label: "AI-native" },
    ...(o.aiInvolvedRate === undefined
      ? {}
      : {
          prStats: {
            analyzed: o.analyzed ?? 20,
            aiInvolvedRate: o.aiInvolvedRate,
            aiGovernedRate: o.aiGovernedRate ?? null,
          },
        }),
  } as unknown as ScanReport;
}

// ---------------------------------------------------------------------------
// 1. The four-place structural guard
// ---------------------------------------------------------------------------

/**
 * One representative value per `GatePolicy` field, plus a STRICTER value for the same field. The
 * `Required<>` type is the whole point: adding a field to `GatePolicy` without adding a row here is
 * a COMPILE error, so this table cannot silently fall behind the interface the way the fleet's
 * fail-reason list once did.
 */
const FIELD_TABLE: { [K in keyof Required<GatePolicy>]: { loose: Required<GatePolicy>[K]; strict: Required<GatePolicy>[K] } } = {
  minLevel: { loose: "L2", strict: "L4" },
  minOverall: { loose: 40, strict: 80 },
  minDimension: { loose: 20, strict: 60 },
  minDimensionFor: { loose: { D9: 20 }, strict: { D9: 70 } },
  forbidPostures: { loose: [], strict: ["ungoverned"] },
  requireProtectedBranch: { loose: false, strict: true },
  minAiGovernedRate: { loose: 50, strict: 100 },
  forbidAiAuthorship: { loose: false, strict: true },
  requireChecks: { loose: [], strict: ["control.prepush.lint"] },
};

const KEYS = Object.keys(FIELD_TABLE) as (keyof GatePolicy)[];

describe("the policy-source contract: every GatePolicy field has its four places", () => {
  it.each(KEYS)("%s survives sanitizeGatePolicy (untrusted -> clean)", (key) => {
    const raw = { [key]: FIELD_TABLE[key].strict } as Record<string, unknown>;
    const clean = sanitizeGatePolicy(raw);
    expect(clean, `sanitizeGatePolicy dropped "${key}" — an untrusted policy carrying it is silently unenforced`).not.toBeNull();
    expect(clean![key]).toBeDefined();
  });

  it.each(KEYS)("%s merges strictest-wins under tightenGatePolicy, in both argument orders", (key) => {
    const { loose, strict } = FIELD_TABLE[key];
    const a = { [key]: loose } as GatePolicy;
    const b = { [key]: strict } as GatePolicy;
    // The strict value must survive whichever side it arrives on: the fold applies the same merge to
    // the org layer, the admission layer and the query params, and the layers arrive in a fixed order
    // the caller does not get to choose.
    expect(tightenGatePolicy(a, b)[key], `tightenGatePolicy lost "${key}" (loose, strict)`).toEqual(strict);
    expect(tightenGatePolicy(b, a)[key], `tightenGatePolicy weakened "${key}" (strict, loose)`).toEqual(strict);
    // A field only one side sets survives — an unset field is not a permission to drop a set one.
    expect(tightenGatePolicy(b, {})[key]).toEqual(strict);
    expect(tightenGatePolicy({}, b)[key]).toEqual(strict);
  });

  it.each(KEYS)("%s renders a condition in describeGatePolicy", (key) => {
    const views = describeGatePolicy({ [key]: FIELD_TABLE[key].strict } as GatePolicy);
    expect(views.length, `describeGatePolicy renders nothing for "${key}" — an enforced bar invisible in the PR footer`).toBeGreaterThan(0);
    expect(views[0]!.text).toBeTruthy();
    expect(views[0]!.bit).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Defect D10 — policyFromParams dropped minAiGovernedRate on the no-org-policy path
// ---------------------------------------------------------------------------

describe("D10: policyFromParams must not drop an explicitly requested field", () => {
  // FAIL-BEFORE: pre-change, policyFromParams hand-listed six fields and minAiGovernedRate was not
  // among them, so this returned undefined — the strictest bar in the product, silently unenforced on
  // every deployment with no persisted org policy.
  it("carries ?min_ai_governed through the archetype-default path", () => {
    expect(policyFromParams(new URLSearchParams("min_ai_governed=90"), "org").minAiGovernedRate).toBe(90);
    expect(policyFromParams(new URLSearchParams("no_ungoverned_ai=1"), "solo").minAiGovernedRate).toBe(100);
  });

  it("still fills unset fields from the archetype default", () => {
    const pol = policyFromParams(new URLSearchParams("min_ai_governed=90"), "org");
    expect(pol.minLevel).toBe("L3");
    expect(pol.minDimension).toBe(40);
    expect(pol.forbidPostures).toEqual(["ungoverned"]);
  });

  it("every field explicitPolicyFromParams can parse reaches the result", () => {
    const params = new URLSearchParams("min_level=L5&min_overall=90&min_dimension=70&min_security=80&no_ungoverned=1&require_protection=1&min_ai_governed=100");
    const explicit = explicitPolicyFromParams(params);
    const merged = policyFromParams(params, "solo");
    for (const key of Object.keys(explicit) as (keyof GatePolicy)[]) {
      expect(merged[key], `policyFromParams dropped the explicitly requested "${key}"`).toEqual(explicit[key]);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. forbidAiAuthorship (#8)
// ---------------------------------------------------------------------------

describe("forbidAiAuthorship — the admission bar", () => {
  // FAIL-BEFORE: with no such field, this policy was inert and the evaluator returned pass:true.
  it("fails a repo with observed AI authorship", () => {
    const res = evaluateGate(report({ aiInvolvedRate: 40 }), { forbidAiAuthorship: true });
    expect(res.pass).toBe(false);
    expect(res.failures[0]!.code).toBe("admission");
    expect(res.failures[0]!.message).toContain("blocked");
  });

  // The fail-OPEN exception, and the reason it is principled: null means the measurement was never
  // DUE (no token / no sample), not that it broke.
  it("SKIPS when AI activity is unmeasurable — a token-less scan is never blocked by an AI policy", () => {
    expect(evaluateGate(report(), { forbidAiAuthorship: true }).pass).toBe(true);
  });

  it("SKIPS a repo with zero observed AI authorship", () => {
    expect(evaluateGate(report({ aiInvolvedRate: 0 }), { forbidAiAuthorship: true }).pass).toBe(true);
  });

  it("evaluateGateLite always skips it — the fleet view must not condemn what the CI gate would clear", () => {
    const snap = { level: "L4", overall: 70, posture: "ai-native", dims: [{ dimId: "D1", score: 80 }] };
    expect(evaluateGateLite(snap, { forbidAiAuthorship: true }).pass).toBe(true);
  });

  it("is not a truthy coercion in the sanitizer", () => {
    expect(sanitizeGatePolicy({ forbidAiAuthorship: "yes" })).toBeNull();
    expect(sanitizeGatePolicy({ forbidAiAuthorship: 1 })).toBeNull();
    expect(sanitizeGatePolicy({ forbidAiAuthorship: true })).toEqual({ forbidAiAuthorship: true });
  });

  it("has no gate-URL / CI projection — admission is recorded by the org, never requested by a caller", () => {
    const [view] = describeGatePolicy({ forbidAiAuthorship: true });
    expect(view!.query).toBeUndefined();
    expect(view!.ci).toBeUndefined();
    // And no query param can install it: the only way in is the admission overlay.
    expect(explicitPolicyFromParams(new URLSearchParams("forbid_ai_authorship=1")).forbidAiAuthorship).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. requireChecks (#16)
// ---------------------------------------------------------------------------

describe("requireChecks — the control bar", () => {
  const pol: GatePolicy = { requireChecks: ["control.prepush.lint", "guardrail.never-commit"] };

  it("fails when the repo's own report names a required check FAILING", () => {
    const res = evaluateGate(report(), pol, { checkStates: { "control.prepush.lint": "fail" } });
    expect(res.pass).toBe(false);
    expect(res.failures[0]!.code).toBe("control");
    expect(res.failures[0]!.message).toContain("control.prepush.lint");
  });

  it("SKIPS every check when there is no ledger at all (null) — never reported is not a failure", () => {
    expect(evaluateGate(report(), pol, { checkStates: null }).pass).toBe(true);
    expect(evaluateGate(report(), pol).pass).toBe(true);
  });

  it("SKIPS a check the latest report did not name — absence is `unchecked`, not a verdict", () => {
    expect(evaluateGate(report(), pol, { checkStates: { "capability.test.run": "pass" } }).pass).toBe(true);
  });

  it("SKIPS `unchecked` and does not fail on `warn`", () => {
    expect(evaluateGate(report(), pol, { checkStates: { "control.prepush.lint": "unchecked" } }).pass).toBe(true);
    expect(evaluateGate(report(), pol, { checkStates: { "control.prepush.lint": "warn" } }).pass).toBe(true);
  });

  it("unions across layers rather than replacing — a layer can add a control, never drop one", () => {
    const merged = tightenGatePolicy({ requireChecks: ["a.one"] }, { requireChecks: ["b.two"] });
    expect(merged.requireChecks).toEqual(["a.one", "b.two"]);
  });

  it("drops malformed ids but keeps unknown well-formed ones (spec principle 3)", () => {
    expect(sanitizeGatePolicy({ requireChecks: ["Not A Check", "", 7, "vendor.future.check"] })).toEqual({
      requireChecks: ["vendor.future.check"],
    });
    expect(sanitizeGatePolicy({ requireChecks: [] })).toBeNull();
  });
});
