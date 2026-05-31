// Maturity Gate — turn a maturity report into an enforceable pass/fail policy (à la SonarQube
// Quality Gates / OpenSSF Scorecard thresholds). evaluateGate() checks a configurable policy
// and returns the specific failing conditions; defaults are archetype-aware (a solo repo is
// held to a lower bar than an org/platform). Consumed by the public badge and the CI endpoint.

import type { LevelId, Posture, RepoArchetype, ScanReport } from "@/lib/types";
import { LEVELS } from "@/lib/maturity/model";

export interface GatePolicy {
  /** Minimum overall maturity level (inclusive), e.g. "L3". */
  minLevel?: LevelId;
  /** Minimum overall score (0..100). */
  minOverall?: number;
  /** No single dimension may score below this. */
  minDimension?: number;
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
  if (pol.forbidPostures?.includes(report.posture.id)) {
    failures.push({
      code: "posture",
      message: `Posture "${report.posture.label}" is not permitted by the gate.`,
    });
  }

  return { pass: failures.length === 0, policy: pol, failures };
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
  return {
    minLevel: isLevelId(minLevel) ? minLevel : base.minLevel,
    minOverall: Number.isFinite(minOverall) && params.get("min_overall") != null ? minOverall : base.minOverall,
    minDimension:
      Number.isFinite(minDimension) && params.get("min_dimension") != null ? minDimension : base.minDimension,
    forbidPostures:
      noUngoverned === "1" || noUngoverned === "true" ? ["ungoverned"] : base.forbidPostures,
  };
}
