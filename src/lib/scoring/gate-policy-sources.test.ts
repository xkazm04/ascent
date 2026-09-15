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
//  4. THE SKIP PATH — every criterion that can be skipped must ANNOUNCE the skip. Keyed on
//     `GateSkip["code"]`, so a new skippable criterion without a skip path is a compile error.

import { describe, it, expect } from "vitest";
import {
  buildGateCaveats,
  describeGatePolicy,
  evaluateGate,
  evaluateGateLite,
  explicitPolicyFromParams,
  policyFromParams,
  sanitizeGatePolicy,
  tightenGatePolicy,
  type GateInputs,
  type GatePolicy,
  type GateSkip,
} from "./gate";
import type { DimensionResult, ScanReport } from "@/lib/types";

function report(
  o: {
    aiInvolvedRate?: number;
    analyzed?: number;
    aiGovernedRate?: number;
    governance?: { readable: boolean; protected: boolean; defaultBranch: string };
    sensorFailures?: string[];
    confidence?: number;
    warnings?: string[];
    prPartial?: boolean;
  } = {},
): ScanReport {
  const dimensions: Pick<DimensionResult, "id" | "name" | "score">[] = [
    { id: "D9", name: "Supply Chain & Security", score: 80 },
    { id: "D1", name: "Foundations", score: 80 },
  ];
  return {
    archetype: "org",
    level: { id: "L4" },
    ...(o.governance ? { governance: o.governance } : {}),
    ...(o.sensorFailures ? { sensorFailures: o.sensorFailures } : {}),
    ...(o.confidence === undefined ? {} : { confidence: o.confidence }),
    ...(o.warnings ? { warnings: o.warnings } : {}),
    ...(o.prPartial ? { prPartial: true } : {}),
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

// ---------------------------------------------------------------------------
// 5. THE SKIP PATH — a criterion that could not be tested must SAY SO
//
// Structural, for the same reason the four-place table above is: `GateSkip["code"]` is the key type,
// so a new skippable criterion added to the union without a row here is a COMPILE error. What it
// guards is the failure this whole channel exists for — a bar that is echoed in `policy`, rendered in
// the PR footer and recorded in the audit row while nothing on the run ever tested it. On the public
// endpoint (token-less by construction) that is the DEFAULT state of three of these four.
// ---------------------------------------------------------------------------

/** One policy per skippable criterion that sets exactly that bar, plus the input that makes it
 *  measurable — so both directions are pinned: null skips, and a real reading does not. */
const SKIP_TABLE: {
  [K in GateSkip["code"]]: { policy: GatePolicy; measurable: () => { report: ScanReport; inputs?: GateInputs } };
} = {
  governance: {
    policy: { requireProtectedBranch: true },
    measurable: () => ({ report: report({ governance: { readable: true, protected: true, defaultBranch: "main" } }) }),
  },
  provenance: {
    policy: { minAiGovernedRate: 50 },
    measurable: () => ({ report: report({ aiInvolvedRate: 40, aiGovernedRate: 90 }) }),
  },
  admission: {
    policy: { forbidAiAuthorship: true },
    measurable: () => ({ report: report({ aiInvolvedRate: 0 }) }),
  },
  control: {
    policy: { requireChecks: ["control.prepush.lint"] },
    measurable: () => ({ report: report(), inputs: { checkStates: { "control.prepush.lint": "pass" } } }),
  },
};

const SKIP_CODES = Object.keys(SKIP_TABLE) as GateSkip["code"][];

describe("every skippable criterion announces its skip", () => {
  it.each(SKIP_CODES)("%s: an unmeasurable input SKIPS with a reason, and the gate still passes", (code) => {
    // `report()` is the blind case for all four: no governance, no prStats, no ledger — which is
    // exactly the shape the unauthenticated endpoint produces on every single call.
    const res = evaluateGate(report(), SKIP_TABLE[code].policy);
    expect(res.pass, `"${code}" must not FAIL an unmeasurable repo — that is the fail-open exception`).toBe(true);
    const skip = res.skipped.find((s) => s.code === code);
    expect(skip, `"${code}" was silently skipped: the verdict echoes the bar with no record that nothing tested it`).toBeDefined();
    expect(skip!.why.length, `"${code}" skipped without saying why`).toBeGreaterThan(20);
  });

  it.each(SKIP_CODES)("%s: a MEASURABLE input produces no skip — an evaluated bar is not 'unmeasured'", (code) => {
    const { report: rep, inputs } = SKIP_TABLE[code].measurable();
    expect(evaluateGate(rep, SKIP_TABLE[code].policy, inputs).skipped.map((s) => s.code)).not.toContain(code);
  });

  it.each(SKIP_CODES)("%s: describeGatePolicy tags its condition, so a renderer can mark the untested bar", (code) => {
    const views = describeGatePolicy(SKIP_TABLE[code].policy);
    expect(views.some((v) => v.code === code), `no describeGatePolicy row carries code "${code}"`).toBe(true);
  });

  it("never records a skip for a bar the policy does not set", () => {
    expect(evaluateGate(report(), { minLevel: "L2" }).skipped).toEqual([]);
  });

  it("a non-finite score is a FAILURE, never a skip — the fail-closed rule is untouched", () => {
    const unscored = { ...report(), overallScore: Number.NaN } as ScanReport;
    const res = evaluateGate(unscored, { minOverall: 40 });
    expect(res.pass).toBe(false);
    expect(res.failures[0]!.code).toBe("overall");
    expect(res.skipped).toEqual([]);
  });

  it("the lite fleet evaluator skips the same criteria rather than inventing verdicts", () => {
    const snap = { level: "L4", overall: 70, posture: "ai-native", dims: [{ dimId: "D1", score: 80 }] };
    const res = evaluateGateLite(snap, { requireProtectedBranch: true, forbidAiAuthorship: true });
    expect(res.pass).toBe(true);
    expect(res.skipped.map((s) => s.code).sort()).toEqual(["admission", "governance"]);
  });
});

// ---------------------------------------------------------------------------
// 6. THE SCAN'S OWN HONESTY FLAGS (quality-gates/gate-liveness)
//
// `ScanReport.sensorFailures`, `confidence`, `warnings` and `prPartial` reached the API body and were
// read by NOTHING in gate.ts / gate-comment.ts / pr-gate.ts. A scan whose governance sensor THREW was
// byte-identical, to every line of gate code, to one where the signal was simply absent — and it
// produced a full-confidence green Check Run. `isIncompleteReport` caught only the total wipeout.
// ---------------------------------------------------------------------------

describe("a failed sensor is an announced skip, not a pass", () => {
  it("says the governance read FAILED, distinctly from 'no token'", () => {
    // FAIL-BEFORE: identical verdict, identical wording, whether the read threw or never ran.
    const res = evaluateGate(report({ sensorFailures: ["governance"] }), { requireProtectedBranch: true });
    expect(res.pass).toBe(true); // still not a failure — we cannot condemn on a read we did not get
    expect(res.skipped[0]!.code).toBe("governance");
    expect(res.skipped[0]!.why).toContain("FAILED");
    expect(res.skipped[0]!.why).toContain("not a pass");
    // The token-less scan keeps its own, different sentence.
    expect(evaluateGate(report(), { requireProtectedBranch: true }).skipped[0]!.why).not.toContain("FAILED");
  });

  it("a failed pullRequests read marks BOTH PR-derived criteria as read-failures", () => {
    const res = evaluateGate(report({ sensorFailures: ["pullRequests"] }), {
      minAiGovernedRate: 100,
      forbidAiAuthorship: true,
    });
    expect(res.skipped.map((s) => s.code).sort()).toEqual(["admission", "provenance"]);
    expect(res.skipped.every((s) => s.why.includes("FAILED"))).toBe(true);
  });

  it("NEVER converts an observed failure into a skip — fail-closed survives", () => {
    // An unprotected branch that WAS observed stays a failure even with an unrelated failed sensor.
    const res = evaluateGate(
      report({ governance: { readable: true, protected: false, defaultBranch: "main" }, sensorFailures: ["securityPosture"] }),
      { requireProtectedBranch: true },
    );
    expect(res.pass).toBe(false);
    expect(res.failures[0]!.code).toBe("governance");
    expect(res.skipped).toEqual([]);
  });

  it("a score-feeding sensor is a CAVEAT, not a skip — a floor on an understated dimension must still bite", () => {
    const res = evaluateGate(report({ sensorFailures: ["securityPosture"] }), { minDimensionFor: { D9: 90 } });
    expect(res.pass).toBe(false); // D9 is 80 in the fixture: the floor still fails it
    expect(res.skipped).toEqual([]);
    expect(res.caveats.join(" ")).toContain("security posture");
  });
});

describe("buildGateCaveats — what the scan says about itself", () => {
  it("names the failed reads, and says they are missing signals rather than missing controls", () => {
    const c = buildGateCaveats({ sensorFailures: ["governance", "securityExposure"] });
    expect(c[0]).toContain("branch governance");
    expect(c[0]).toContain("dependency exposure");
    expect(c[0]).toContain("not absent from the repository");
  });

  it("caveats a scan under the coverage floor the scan itself declares", () => {
    expect(buildGateCaveats({ sensorFailures: [], confidence: 0.3 }).join(" ")).toContain("~30% of the repository");
    expect(buildGateCaveats({ sensorFailures: [], confidence: 0.9 })).toEqual([]);
  });

  it("repeats the report's OWN low-coverage words rather than inventing a second wording", () => {
    const c = buildGateCaveats({
      sensorFailures: [],
      confidence: 0.9,
      warnings: ["Only part of the repository could be inspected (~40% coverage); treat scores as indicative.", "unrelated caveat"],
    });
    expect(c).toHaveLength(1);
    expect(c[0]).toContain("The scan reports:");
    expect(c[0]).toContain("~40% coverage");
  });

  it("carries the truncated-PR flag, which understates the very dimensions a gate floors", () => {
    expect(buildGateCaveats({ sensorFailures: [], prPartial: true }).join(" ")).toContain("Review, Velocity");
  });

  it("says nothing about a clean scan", () => {
    expect(buildGateCaveats({ sensorFailures: [], confidence: 0.95, warnings: [], prPartial: false })).toEqual([]);
  });

  it("reaches the verdict from the report with no threading required of the caller", () => {
    const res = evaluateGate(report({ confidence: 0.2, prPartial: true }), { minLevel: "L2" });
    expect(res.caveats).toHaveLength(2);
    // A caveat never becomes a verdict of its own.
    expect(res.pass).toBe(true);
  });

  it("attaches to the INCOMPLETE short-circuit too — that verdict needs them most", () => {
    const blind = { ...report({ sensorFailures: ["governance"] }), dimensions: [] } as unknown as ScanReport;
    const res = evaluateGate(blind, { minLevel: "L2" });
    expect(res.failures[0]!.code).toBe("incomplete");
    expect(res.caveats.join(" ")).toContain("branch governance");
  });
});
