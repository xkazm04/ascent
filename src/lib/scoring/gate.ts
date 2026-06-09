// Maturity Gate — turn a maturity report into an enforceable pass/fail policy (à la SonarQube
// Quality Gates / OpenSSF Scorecard thresholds). evaluateGate() checks a configurable policy
// and returns the specific failing conditions; defaults are archetype-aware (a solo repo is
// held to a lower bar than an org/platform). Consumed by the public badge and the CI endpoint.

import type { DimensionId, LevelId, Posture, RepoArchetype, ScanReport } from "@/lib/types";
import { LEVELS, DIMENSION_BY_ID } from "@/lib/maturity/model";

/** The Security dimension + the default floor a security gate holds it to (`?security=1`). */
export const SECURITY_DIM: DimensionId = "D9";
export const DEFAULT_SECURITY_MIN = 50;

export interface GatePolicy {
  /** Minimum overall maturity level (inclusive), e.g. "L3". */
  minLevel?: LevelId;
  /** Minimum overall score (0..100). */
  minOverall?: number;
  /** No single dimension may score below this. */
  minDimension?: number;
  /** Per-dimension floors (e.g. a security gate: { D9: 50 }) — checked in addition to minDimension. */
  minDimensionFor?: Partial<Record<DimensionId, number>>;
  /** Postures that fail the gate outright (e.g. "ungoverned" = heavy AI, light guardrails). */
  forbidPostures?: Posture["id"][];
}

export interface GateFailure {
  code: "level" | "overall" | "dimension" | "posture";
  message: string;
}

export interface GateResult {
  pass: boolean;
  policy: GatePolicy;
  failures: GateFailure[];
}

const levelNum = (id: LevelId) => Number(id.slice(1));

function isLevelId(v: string | null | undefined): v is LevelId {
  return v != null && LEVELS.some((l) => l.id === v);
}

/**
 * Archetype-aware default policy: orgs/platforms are held to a higher bar (L3, no dimension
 * below 40, and no "ungoverned" posture) than solo/early repos (L2, no dimension below 25),
 * so the gate is fair to how the repo is actually run.
 */
export function defaultGatePolicy(archetype: RepoArchetype): GatePolicy {
  switch (archetype) {
    case "org":
      return { minLevel: "L3", minDimension: 40, forbidPostures: ["ungoverned"] };
    case "team":
      return { minLevel: "L3", minDimension: 35 };
    case "solo":
    default:
      return { minLevel: "L2", minDimension: 25 };
  }
}

/** Evaluate a report against a policy (defaults to the archetype policy), listing every failure. */
export function evaluateGate(report: ScanReport, policy?: GatePolicy): GateResult {
  const pol = policy ?? defaultGatePolicy(report.archetype);
  const failures: GateFailure[] = [];

  if (pol.minLevel && levelNum(report.level.id) < levelNum(pol.minLevel)) {
    failures.push({
      code: "level",
      message: `Overall level ${report.level.id} is below the required ${pol.minLevel}.`,
    });
  }
  if (typeof pol.minOverall === "number" && report.overallScore < pol.minOverall) {
    failures.push({
      code: "overall",
      message: `Overall score ${report.overallScore} is below the required ${pol.minOverall}.`,
    });
  }
  if (typeof pol.minDimension === "number") {
    const min = pol.minDimension;
    for (const d of report.dimensions.filter((x) => x.score < min)) {
      failures.push({
        code: "dimension",
        message: `${d.id} ${d.name} scored ${d.score}, below the required ${min}.`,
      });
    }
  }
  if (pol.minDimensionFor) {
    const floors = pol.minDimensionFor;
    for (const d of report.dimensions) {
      const floor = floors[d.id];
      // Skip dims already failed by the global minDimension to avoid a duplicate failure for the same dim.
      const alreadyFailed = typeof pol.minDimension === "number" && d.score < pol.minDimension;
      if (typeof floor === "number" && d.score < floor && !alreadyFailed) {
        failures.push({
          code: "dimension",
          message: `${d.id} ${d.name} scored ${d.score}, below the required ${floor}.`,
        });
      }
    }
  }
  if (pol.forbidPostures?.includes(report.posture.id)) {
    failures.push({
      code: "posture",
      message: `Posture "${report.posture.label}" is not permitted by the gate.`,
    });
  }

  return { pass: failures.length === 0, policy: pol, failures };
}

/**
 * The minimal repo snapshot the fleet gate needs — exactly what the org rollup already carries per
 * repo (no full ScanReport, so we can gate the whole fleet without re-scanning).
 */
export interface GateSnapshot {
  level: string; // e.g. "L3"
  overall: number;
  posture: string; // posture id, e.g. "ungoverned"
  dims: { dimId: string; score: number }[];
}

/**
 * Evaluate a lightweight snapshot against a policy — the SAME rules as evaluateGate(), so the
 * dashboard's fleet status and the CI gate agree. Used to compute org-wide gate analytics cheaply.
 */
export function evaluateGateLite(snap: GateSnapshot, policy: GatePolicy): GateResult {
  const failures: GateFailure[] = [];
  const dimName = (id: string) => DIMENSION_BY_ID[id as DimensionId]?.name ?? id;

  if (policy.minLevel && (Number(snap.level.replace(/^L/i, "")) || 0) < levelNum(policy.minLevel)) {
    failures.push({ code: "level", message: `Level ${snap.level} is below the required ${policy.minLevel}.` });
  }
  if (typeof policy.minOverall === "number" && snap.overall < policy.minOverall) {
    failures.push({ code: "overall", message: `Overall score ${snap.overall} is below the required ${policy.minOverall}.` });
  }
  if (typeof policy.minDimension === "number") {
    const min = policy.minDimension;
    for (const d of snap.dims.filter((x) => x.score < min)) {
      failures.push({ code: "dimension", message: `${d.dimId} ${dimName(d.dimId)} scored ${d.score}, below the required ${min}.` });
    }
  }
  if (policy.minDimensionFor) {
    const floors = policy.minDimensionFor;
    for (const d of snap.dims) {
      const floor = floors[d.dimId as DimensionId];
      // Skip dims already failed by the global minDimension to avoid a duplicate failure for the same dim.
      const alreadyFailed = typeof policy.minDimension === "number" && d.score < policy.minDimension;
      if (typeof floor === "number" && d.score < floor && !alreadyFailed) {
        failures.push({ code: "dimension", message: `${d.dimId} ${dimName(d.dimId)} scored ${d.score}, below the required ${floor}.` });
      }
    }
  }
  if (policy.forbidPostures?.some((p) => p === snap.posture)) {
    failures.push({ code: "posture", message: `Posture "${snap.posture}" is not permitted by the gate.` });
  }
  return { pass: failures.length === 0, policy, failures };
}

/**
 * Build a policy from URL query params, falling back to the archetype default for anything
 * unset — so the badge and CI endpoint accept e.g. `?min_level=L4&min_dimension=50&no_ungoverned=1`.
 */
export function policyFromParams(params: URLSearchParams, archetype: RepoArchetype): GatePolicy {
  const base = defaultGatePolicy(archetype);
  const minLevel = params.get("min_level");
  const minOverall = Number(params.get("min_overall"));
  const minDimension = Number(params.get("min_dimension"));
  const noUngoverned = params.get("no_ungoverned");

  // Security gate: `?security=1` (default D9 floor) or `?min_security=N` (explicit floor). Both pin a
  // per-dimension floor on Security (D9) AND forbid the "ungoverned" posture — the security policy.
  const minSecurity = Number(params.get("min_security"));
  const hasMinSecurity = Number.isFinite(minSecurity) && params.get("min_security") != null;
  const wantSecurity = params.get("security") === "1" || params.get("security") === "true" || hasMinSecurity;
  const securityFloor = hasMinSecurity ? minSecurity : DEFAULT_SECURITY_MIN;

  return {
    minLevel: isLevelId(minLevel) ? minLevel : base.minLevel,
    minOverall: Number.isFinite(minOverall) && params.get("min_overall") != null ? minOverall : base.minOverall,
    minDimension:
      Number.isFinite(minDimension) && params.get("min_dimension") != null ? minDimension : base.minDimension,
    minDimensionFor: wantSecurity ? { [SECURITY_DIM]: securityFloor } : base.minDimensionFor,
    forbidPostures:
      noUngoverned === "1" || noUngoverned === "true" || wantSecurity ? ["ungoverned"] : base.forbidPostures,
  };
}
