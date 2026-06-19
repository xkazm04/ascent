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
  /** Fail the gate when the default branch is readable but NOT protected. Branch protection is folded
   *  into the dimension scores ADDITIVELY (its absence never demotes — a read token may not see classic
   *  protection), so a repo with no guardrails can still pass on score alone. This makes "is the default
   *  branch actually protected?" an explicit, enforceable bar. Opt-in, and only fails when governance was
   *  READABLE (a token saw the rules), so a no-token scan never false-fails. */
  requireProtectedBranch?: boolean;
}

export interface GateFailure {
  code: "level" | "overall" | "dimension" | "posture" | "governance";
  message: string;
}

export interface GateResult {
  pass: boolean;
  policy: GatePolicy;
  failures: GateFailure[];
}

const levelNum = (id: LevelId) => Number(id.slice(1));

/**
 * Fail-closed dimension floor check: a non-finite (missing / NaN) score is treated as BELOW any floor.
 * A plain `score < min` quietly evaluates `undefined < 40` / `NaN < 40` to `false`, so an UNSCORED
 * dimension (partial LLM output, a new dimension the model skipped) would slip the gate as if passing —
 * letting the exact Security/Testing dimension a gate exists to enforce be bypassed by absence of data.
 */
function belowFloor(score: number, min: number): boolean {
  return !Number.isFinite(score) || score < min;
}

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

/**
 * Validate an untrusted policy object (from the settings form / DB) into a clean GatePolicy, or null
 * when nothing usable is present. Scores are clamped to 0..100 ints; minLevel must be a real level id;
 * per-dimension floors keep only D1..D9 keys; forbidPostures keeps only the gate-relevant "ungoverned".
 */
export function sanitizeGatePolicy(raw: unknown): GatePolicy | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const clampScore = (v: unknown): number | undefined => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.trunc(n) : undefined;
  };
  // A floor of 0 (or negative) is an always-pass gate that still LOOKS configured. Treat <= 0 as
  // "not set" and DROP the key, matching policyFromParams's `> 0` rule (a real floor is positive).
  const floorScore = (v: unknown): number | undefined => {
    const n = clampScore(v);
    return n !== undefined && n > 0 ? n : undefined;
  };
  const pol: GatePolicy = {};
  if (typeof r.minLevel === "string" && isLevelId(r.minLevel)) pol.minLevel = r.minLevel;
  const mo = floorScore(r.minOverall);
  if (mo !== undefined) pol.minOverall = mo;
  const md = floorScore(r.minDimension);
  if (md !== undefined) pol.minDimension = md;
  if (r.minDimensionFor && typeof r.minDimensionFor === "object") {
    const floors: Partial<Record<DimensionId, number>> = {};
    for (const [k, v] of Object.entries(r.minDimensionFor as Record<string, unknown>)) {
      if (/^D[1-9]$/.test(k)) {
        const n = floorScore(v);
        if (n !== undefined) floors[k as DimensionId] = n;
      }
    }
    if (Object.keys(floors).length) pol.minDimensionFor = floors;
  }
  if (Array.isArray(r.forbidPostures)) {
    const allowed = r.forbidPostures.filter((p): p is "ungoverned" => p === "ungoverned");
    if (allowed.length) pol.forbidPostures = allowed;
  }
  if (r.requireProtectedBranch === true) pol.requireProtectedBranch = true;
  return Object.keys(pol).length ? pol : null;
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
    for (const d of report.dimensions.filter((x) => belowFloor(x.score, min))) {
      failures.push({
        code: "dimension",
        message: Number.isFinite(d.score)
          ? `${d.id} ${d.name} scored ${d.score}, below the required ${min}.`
          : `${d.id} ${d.name} is unscored — failing the ${min} floor (fail-closed).`,
      });
    }
  }
  if (pol.minDimensionFor) {
    const floors = pol.minDimensionFor;
    for (const d of report.dimensions) {
      const floor = floors[d.id];
      if (typeof floor !== "number") continue;
      // Skip dims already failed by the global minDimension to avoid a duplicate failure for the same dim.
      const alreadyFailed = typeof pol.minDimension === "number" && belowFloor(d.score, pol.minDimension);
      if (belowFloor(d.score, floor) && !alreadyFailed) {
        failures.push({
          code: "dimension",
          message: Number.isFinite(d.score)
            ? `${d.id} ${d.name} scored ${d.score}, below the required ${floor}.`
            : `${d.id} ${d.name} is unscored — failing the ${floor} floor (fail-closed).`,
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
  // Governance: only enforce when readable (a token saw the rules) so a no-token scan never false-fails.
  if (pol.requireProtectedBranch && report.governance?.readable && !report.governance.protected) {
    failures.push({
      code: "governance",
      message: `Default branch "${report.governance.defaultBranch}" has no branch-protection rules — the gate requires a protected default branch.`,
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
  /** Default-branch protection, when the rollup carries it. `requireProtectedBranch` is enforced here
   *  only when `govReadable` is true (parity with evaluateGate's readable-gated check); absent → skipped. */
  protected?: boolean;
  govReadable?: boolean;
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
    for (const d of snap.dims.filter((x) => belowFloor(x.score, min))) {
      failures.push({
        code: "dimension",
        message: Number.isFinite(d.score)
          ? `${d.dimId} ${dimName(d.dimId)} scored ${d.score}, below the required ${min}.`
          : `${d.dimId} ${dimName(d.dimId)} is unscored — failing the ${min} floor (fail-closed).`,
      });
    }
  }
  if (policy.minDimensionFor) {
    const floors = policy.minDimensionFor;
    for (const d of snap.dims) {
      const floor = floors[d.dimId as DimensionId];
      if (typeof floor !== "number") continue;
      // Skip dims already failed by the global minDimension to avoid a duplicate failure for the same dim.
      const alreadyFailed = typeof policy.minDimension === "number" && belowFloor(d.score, policy.minDimension);
      if (belowFloor(d.score, floor) && !alreadyFailed) {
        failures.push({
          code: "dimension",
          message: Number.isFinite(d.score)
            ? `${d.dimId} ${dimName(d.dimId)} scored ${d.score}, below the required ${floor}.`
            : `${d.dimId} ${dimName(d.dimId)} is unscored — failing the ${floor} floor (fail-closed).`,
        });
      }
    }
  }
  if (policy.forbidPostures?.some((p) => p === snap.posture)) {
    failures.push({ code: "posture", message: `Posture "${snap.posture}" is not permitted by the gate.` });
  }
  // Parity with evaluateGate: enforce only when the snapshot carries readable governance. Rollups that
  // don't yet carry per-repo protection simply leave it unset → skipped (no false-fail on the fleet view).
  if (policy.requireProtectedBranch && snap.govReadable && snap.protected === false) {
    failures.push({ code: "governance", message: "Default branch has no branch-protection rules — the gate requires a protected default branch." });
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
  const requireProtection = params.get("require_protection");

  // Security gate: `?security=1` (default D9 floor) or `?min_security=N` (explicit floor). Both pin a
  // per-dimension floor on Security (D9) AND forbid the "ungoverned" posture — the security policy.
  const minSecurity = Number(params.get("min_security"));
  // Require a POSITIVE floor: `?min_security=` (empty → Number("")=0) and `?min_security=0` both parse
  // to a finite 0, which used to read as "security floor requested, floor=0" — an always-pass gate that
  // still LOOKED like a security gate. Treat empty/0/absent as "not requested" (a real floor is > 0).
  const hasMinSecurity = Number.isFinite(minSecurity) && minSecurity > 0;
  const wantSecurity = params.get("security") === "1" || params.get("security") === "true" || hasMinSecurity;
  const securityFloor = hasMinSecurity ? minSecurity : DEFAULT_SECURITY_MIN;

  return {
    minLevel: isLevelId(minLevel) ? minLevel : base.minLevel,
    // Require a POSITIVE floor (like min_security): `?min_overall=` (Number("")=0) and `?min_overall=0`
    // both parse to a finite 0, which would install an always-pass gate that silently disarms CI
    // protection. A <=0 / invalid value falls back to the archetype default rather than weakening the gate.
    minOverall:
      Number.isFinite(minOverall) && minOverall > 0 && params.get("min_overall") != null
        ? minOverall
        : base.minOverall,
    minDimension:
      Number.isFinite(minDimension) && minDimension > 0 && params.get("min_dimension") != null
        ? minDimension
        : base.minDimension,
    minDimensionFor: wantSecurity ? { [SECURITY_DIM]: securityFloor } : base.minDimensionFor,
    forbidPostures:
      noUngoverned === "1" || noUngoverned === "true" || wantSecurity ? ["ungoverned"] : base.forbidPostures,
    requireProtectedBranch:
      requireProtection === "1" || requireProtection === "true" ? true : base.requireProtectedBranch,
  };
}
