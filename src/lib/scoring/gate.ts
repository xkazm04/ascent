// Maturity Gate — turn a maturity report into an enforceable pass/fail policy (à la SonarQube
// Quality Gates / OpenSSF Scorecard thresholds). evaluateGate() checks a configurable policy
// and returns the specific failing conditions; defaults are archetype-aware (a solo repo is
// held to a lower bar than an org/platform). Consumed by the public badge and the CI endpoint.

import type { DimensionId, LevelId, Posture, RepoArchetype, ScanReport } from "@/lib/types";
import { LEVELS, DIMENSION_BY_ID } from "@/lib/maturity/model";
import { parseFloor } from "@/lib/scoring/gate-numeric";

/** The Security dimension + the default floor a security gate holds it to (`?security=1`). */
const SECURITY_DIM: DimensionId = "D9";
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
  /**
   * THE UNGOVERNED-AI-CHANGE BAR (W2). Minimum share (0..100) of AI-attributed merged PRs that
   * carried an approving human review — `PrStats.aiGovernedRate`. 100 means "every AI-attributed
   * change must be approved before it merges".
   *
   * This is the one policy in the market that is described everywhere and productized nowhere
   * (docs/AI-SDLC-STANDARDS-LANDSCAPE.md §3.4), and it is deliberately built on the SAME
   * deterministic signal the evidence pack reports — a gate and an audit artifact that disagreed
   * about whether AI work is governed would discredit both.
   *
   * ONLY ENFORCED WHEN MEASURABLE. `aiGovernedRate` is null with no token, and null under the ≥5
   * AI-PR sample floor. Null → the criterion is SKIPPED, exactly like `requireProtectedBranch`'s
   * readable gate. Failing an unmeasurable repo would punish repos for having little AI activity,
   * which inverts the policy's whole intent.
   */
  minAiGovernedRate?: number;
}

export interface GateFailure {
  code: "level" | "overall" | "dimension" | "posture" | "governance" | "provenance" | "incomplete";
  message: string;
}

/**
 * The scan scored NOTHING — every detector failed or returned no data (`ScanReport.incomplete`), so
 * `overallScore`/`level` are the renormalized floor (0 / L1) rather than a measurement. A gate must
 * never certify or condemn a repo on that: it is an ingestion failure wearing a verdict's clothes.
 *
 * Derived, not just read: `incomplete` is stamped by the current engine, but a persisted/reconstructed
 * report can predate the field — and an empty `dimensions` array means exactly the same thing — so both
 * count. (Fail-closed by design: a gate that can't see the repo fails, it doesn't pass.)
 */
export function isIncompleteReport(report: Pick<ScanReport, "incomplete" | "dimensions">): boolean {
  return report.incomplete === true || report.dimensions.length === 0;
}

const INCOMPLETE_MESSAGE =
  "This scan is INCOMPLETE — no dimension could be scored (every detector failed or returned no data), " +
  "so its 0 / L1 result is not a measurement. The gate fails closed rather than certify or condemn a " +
  "repository on an ingestion failure; re-scan or check repository access.";

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

/**
 * The EFFECTIVE floor a dimension is held to: the stricter of the global `minDimension` and any
 * per-dimension `minDimensionFor` override. The single source for this precedence — the gate verdict
 * (the two floor sweeps in {@link evaluateNormalized}), the PR-comment "where the score falls short"
 * table, and the fleet green-path math all derive a dim's floor from here.
 */
export function effectiveFloor(policy: GatePolicy, dimId: string): number {
  return Math.max(policy.minDimension ?? 0, policy.minDimensionFor?.[dimId as DimensionId] ?? 0);
}

/** Whether `score` misses its effective floor, fail-closed on a non-finite (unscored) score. */
export function failsFloor(policy: GatePolicy, dimId: string, score: number): boolean {
  return belowFloor(score, effectiveFloor(policy, dimId));
}

/** One enforced gate condition, rendered into every surface that must stay in lockstep. */
export interface GateConditionView {
  /** Human-readable sentence — the governance dashboard list + LLM brief (`policyText`). */
  text: string;
  /** Terse chip for the PR-comment footer (`policyBits`). */
  bit: string;
  /** Gate-API query param as `[key, value]`, present only when the gate URL exposes this condition. */
  query?: [string, string];
  /** GitHub-Action `with:` line, present only when the action input exposes this condition. */
  ci?: string;
}

/**
 * The ONE ordered enumeration of an active policy's conditions, each pre-rendered into all four
 * projections that previously hand-walked GatePolicy in lockstep: the human-readable list
 * (`policyText`), the PR-comment footer (`policyBits`), the gate-API query string (`gateQuery`),
 * and the GitHub-Action `with:` lines (`ciWith`). They can no longer drift — the PR footer used to
 * silently omit the D9 security floor + protected-branch rule the gate actually enforces. `query`
 * and `ci` are populated only for conditions the gate URL / action input expose (the per-dimension
 * Security floor maps to `min_security`; protection to `require_protection`); other per-dimension
 * floors still render into `text`/`bit` so every enforced condition is visible.
 */
export function describeGatePolicy(p: GatePolicy): GateConditionView[] {
  const out: GateConditionView[] = [];
  if (p.minLevel) {
    out.push({ text: `Minimum overall level ${p.minLevel}`, bit: `min ${p.minLevel}`, query: ["min_level", p.minLevel], ci: `min-level: ${p.minLevel}` });
  }
  if (typeof p.minOverall === "number") {
    out.push({ text: `Overall score ≥ ${p.minOverall}`, bit: `min overall ${p.minOverall}`, query: ["min_overall", String(p.minOverall)], ci: `min-overall: '${p.minOverall}'` });
  }
  if (typeof p.minDimension === "number") {
    out.push({ text: `Every dimension ≥ ${p.minDimension}`, bit: `no dim < ${p.minDimension}`, query: ["min_dimension", String(p.minDimension)], ci: `min-dimension: '${p.minDimension}'` });
  }
  for (const [dim, floor] of Object.entries(p.minDimensionFor ?? {})) {
    const exposed = dim === SECURITY_DIM; // only the Security floor has a gate URL / action input
    out.push({
      text: `${dim} (${DIMENSION_BY_ID[dim as DimensionId]?.name ?? dim}) ≥ ${floor}`,
      bit: `no ${dim} < ${floor}`,
      ...(exposed ? { query: ["min_security", String(floor)] as [string, string], ci: `min-security: '${floor}'` } : {}),
    });
  }
  if (p.forbidPostures?.length) {
    const forbids = p.forbidPostures;
    const exposesUngoverned = forbids.includes("ungoverned"); // the only posture the gate URL/action expose
    out.push({
      text: `No ${forbids.map((x) => `"${x}"`).join(" / ")} posture`,
      bit: `forbid ${forbids.join("/")}`,
      ...(exposesUngoverned ? { query: ["no_ungoverned", "1"] as [string, string], ci: `no-ungoverned: 'true'` } : {}),
    });
  }
  if (p.requireProtectedBranch) {
    out.push({ text: "Default branch must be protected", bit: "protected branch", query: ["require_protection", "1"], ci: `require-protection: 'true'` });
  }
  if (typeof p.minAiGovernedRate === "number") {
    out.push({
      text:
        p.minAiGovernedRate >= 100
          ? "Every AI-attributed merged PR must carry an approving human review"
          : `≥ ${p.minAiGovernedRate}% of AI-attributed merged PRs approved by a human`,
      bit: `AI review ≥ ${p.minAiGovernedRate}%`,
      query: ["min_ai_governed", String(p.minAiGovernedRate)],
      ci: `min-ai-governed: '${p.minAiGovernedRate}'`,
    });
  }
  return out;
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
  // A floor of 0 (or negative) is an always-pass gate that still LOOKS configured. Treat <= 0 as
  // "not set" and DROP the key — the exact same rule floorParam (below) applies to a query-param
  // overlay, single-sourced as parseFloor in gate-numeric.ts.
  const floorScore = parseFloor;
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
  // W2. Same floor contract as every other numeric bar: <=0 is an always-pass wearing a configured
  // policy's clothes, >100 is unreachable — both drop the key rather than install a fake gate.
  const air = floorScore(r.minAiGovernedRate);
  if (air !== undefined) pol.minAiGovernedRate = air;
  return Object.keys(pol).length ? pol : null;
}

/**
 * The shape-neutral view of a scan the gate rules actually need. Both `evaluateGate` (full
 * `ScanReport`) and `evaluateGateLite` (the cheap org-rollup `GateSnapshot`) adapt their input
 * into this and run {@link evaluateNormalized}, so the five gate rules — minLevel, minOverall,
 * the minDimension floor sweep, the per-dim minDimensionFor sweep (incl. the "already failed by
 * the global min" de-dup and the fail-closed unscored split), forbidPostures, and the
 * readable-gated requireProtectedBranch — live in ONE place. The dashboard's fleet status and the
 * CI gate can no longer drift because they evaluate the same code, not hand-synced copies.
 *
 * Per-shape display strings (the level wording and the governance message differ between the two
 * public paths) are passed in as `levelLabel` and `governanceMessage` so each wrapper preserves
 * its exact message text.
 */
interface NormalizedGate {
  /** Numeric level (e.g. 3 for "L3"), already parsed from the shape's level field. */
  level: number;
  /** Display string for the level-failure message (report: "Overall level L2"; lite: "Level L2"). */
  levelLabel: string;
  overall: number;
  posture: { id: string; label: string };
  dims: { id: string; name: string; score: number }[];
  /** Whether the protected-branch rule should be enforced for this shape (readable-gated). */
  governanceEnforce: boolean;
  /** The exact governance-failure message for this shape (report names the branch; lite is generic). */
  governanceMessage: string;
  /**
   * Share (0..100) of AI-attributed merged PRs that carried an approving human review, or NULL when
   * unmeasurable (no token, or under the ≥5 AI-PR sample floor). Null SKIPS `minAiGovernedRate` —
   * see the policy field's doc for why an unmeasurable repo must not fail this bar.
   */
  aiGovernedRate: number | null;
  /** How many AI PRs backed that rate, for the failure message. */
  aiPrSample: number | null;
}

function evaluateNormalized(g: NormalizedGate, pol: GatePolicy): GateFailure[] {
  const failures: GateFailure[] = [];

  // Fail-closed applies to EVERY criterion, not only the dimension floors (ambiguity-ui 2026-07-16
  // ci-gate #2). A plain `<` comparison lets malformed input slip the gate: `NaN < 40 === false`, so
  // a partially corrupt persisted report (missing overallScore) or a malformed level id sailed past
  // minOverall/minLevel and could produce pass:true — while evaluateGateLite parsed the same level as
  // 0 and FAILED it, the exact verdict drift this shared evaluator exists to prevent. An unscored
  // level normalizes to 0 in both wrappers (never a real band — levels are L1..L5), and a non-finite
  // overall reuses belowFloor, so both criteria now fail closed with an explicit "unscored" message.
  if (pol.minLevel) {
    if (!Number.isFinite(g.level) || g.level <= 0) {
      failures.push({
        code: "level",
        message: `The maturity level is unscored — failing the required ${pol.minLevel} (fail-closed).`,
      });
    } else if (g.level < levelNum(pol.minLevel)) {
      failures.push({ code: "level", message: `${g.levelLabel} is below the required ${pol.minLevel}.` });
    }
  }
  if (typeof pol.minOverall === "number" && belowFloor(g.overall, pol.minOverall)) {
    failures.push({
      code: "overall",
      message: Number.isFinite(g.overall)
        ? `Overall score ${g.overall} is below the required ${pol.minOverall}.`
        : `Overall score is unscored — failing the required ${pol.minOverall} (fail-closed).`,
    });
  }
  if (typeof pol.minDimension === "number") {
    const min = pol.minDimension;
    for (const d of g.dims.filter((x) => belowFloor(x.score, min))) {
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
    for (const d of g.dims) {
      const floor = floors[d.id as DimensionId];
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
  if (pol.forbidPostures?.some((p) => p === g.posture.id)) {
    failures.push({ code: "posture", message: `Posture "${g.posture.label}" is not permitted by the gate.` });
  }
  // Governance: only enforce when readable (a token saw the rules) so a no-token scan never false-fails.
  if (pol.requireProtectedBranch && g.governanceEnforce) {
    failures.push({ code: "governance", message: g.governanceMessage });
  }
  // PROVENANCE (W2): were AI-attributed changes actually reviewed by a human before merge?
  //
  // Deliberately NOT fail-closed, which is the opposite of every criterion above — and the exception
  // is principled. The other criteria fail closed because an unscored dimension means the measurement
  // BROKE. Here, null means the measurement was never DUE: the repo had no token, or fewer than five
  // AI PRs in the window. Failing those would block every repo with little AI activity from merging,
  // on a policy whose entire purpose is to govern repos that have a lot of it.
  if (typeof pol.minAiGovernedRate === "number" && g.aiGovernedRate != null) {
    if (g.aiGovernedRate < pol.minAiGovernedRate) {
      const sample = g.aiPrSample != null ? ` (${g.aiPrSample} AI-attributed PRs sampled)` : "";
      failures.push({
        code: "provenance",
        message:
          `${Math.round(g.aiGovernedRate)}% of AI-attributed merged PRs carried an approving human review, ` +
          `below the required ${pol.minAiGovernedRate}%${sample}.`,
      });
    }
  }

  return failures;
}

/** Evaluate a report against a policy (defaults to the archetype policy), listing every failure. */
export function evaluateGate(report: ScanReport, policy?: GatePolicy): GateResult {
  const pol = policy ?? defaultGatePolicy(report.archetype);
  // An unscorable scan short-circuits: running the criteria would emit a wall of "D1 scored 0" style
  // failures that read as findings about the repository, when the only true statement is that nothing
  // was measured. One honest failure instead. (G3-10)
  if (isIncompleteReport(report)) {
    return { pass: false, policy: pol, failures: [{ code: "incomplete", message: INCOMPLETE_MESSAGE }] };
  }
  const failures = evaluateNormalized(
    {
      // `|| 0` aligns the malformed-level parse with evaluateGateLite's (a bogus level id → NaN → 0
      // → fail-closed under any minLevel), so the two evaluators agree on corrupt input.
      level: levelNum(report.level.id) || 0,
      levelLabel: `Overall level ${report.level.id}`,
      overall: report.overallScore,
      posture: { id: report.posture.id, label: report.posture.label },
      dims: report.dimensions.map((d) => ({ id: d.id, name: d.name, score: d.score })),
      governanceEnforce: !!(report.governance?.readable && !report.governance.protected),
      governanceMessage: `Default branch "${report.governance?.defaultBranch}" has no branch-protection rules — the gate requires a protected default branch.`,
      // W2: null on a token-less scan (no prStats at all) AND under the engine's own ≥5 AI-PR floor,
      // which is exactly the "not measurable" the provenance rule skips on.
      aiGovernedRate: report.prStats?.aiGovernedRate ?? null,
      aiPrSample: report.prStats ? Math.round((report.prStats.aiInvolvedRate / 100) * report.prStats.analyzed) : null,
    },
    pol,
  );
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
  /** Share (0..100) of AI-attributed merged PRs with an approving human review. Absent/null →
   *  `minAiGovernedRate` is skipped, the same not-measurable rule evaluateGate applies. */
  aiGovernedRate?: number | null;
  /** AI PRs behind that rate, for the failure message. */
  aiPrSample?: number | null;
}

/**
 * Evaluate a lightweight snapshot against a policy — the SAME rules as evaluateGate(), so the
 * dashboard's fleet status and the CI gate agree. Used to compute org-wide gate analytics cheaply.
 */
export function evaluateGateLite(snap: GateSnapshot, policy: GatePolicy): GateResult {
  const dimName = (id: string) => DIMENSION_BY_ID[id as DimensionId]?.name ?? id;
  const failures = evaluateNormalized(
    {
      level: Number(snap.level.replace(/^L/i, "")) || 0,
      levelLabel: `Level ${snap.level}`,
      overall: snap.overall,
      // The lite snapshot carries only the posture id; it doubles as the label (parity with the
      // original lite message, which interpolated the id directly).
      posture: { id: snap.posture, label: snap.posture },
      dims: snap.dims.map((d) => ({ id: d.dimId, name: dimName(d.dimId), score: d.score })),
      // Parity with evaluateGate: enforce only when the snapshot carries readable governance. Rollups
      // that don't yet carry per-repo protection leave it unset → skipped (no false-fail on the fleet view).
      governanceEnforce: !!(snap.govReadable && snap.protected === false),
      governanceMessage: "Default branch has no branch-protection rules — the gate requires a protected default branch.",
      // Parity with evaluateGate: a rollup that doesn't carry the rate leaves it undefined → skipped,
      // so the fleet view never invents a provenance failure the CI gate wouldn't also raise.
      aiGovernedRate: snap.aiGovernedRate ?? null,
      aiPrSample: snap.aiPrSample ?? null,
    },
    policy,
  );
  return { pass: failures.length === 0, policy, failures };
}

// A query-param floor must satisfy the SAME numeric contract as sanitizeGatePolicy's floorScore:
// finite, truncated to an int, and 0 < n <= 100. Anything else (empty/0/NaN/fractional/out-of-range
// like ?min_overall=150 or ?min_security=999) is "not a usable floor" → undefined, so the caller falls
// back to the archetype default rather than installing an always-pass (<=0) or unreachable (>100)
// floor that silently turns the gate into an always-pass or always-fail wall. (ci-gate-status-checks #5)
// Single-sourced as parseFloor (gate-numeric.ts) — the same function floorScore above uses.
const floorParam = (params: URLSearchParams, name: string): number | undefined => {
  if (params.get(name) == null) return undefined;
  return parseFloor(params.get(name));
};

/**
 * ONLY the policy fields the query string explicitly requests — no archetype fallback for anything
 * unset. This is the params-as-an-OVERLAY view: the gate endpoint merges it over a persisted org
 * policy via {@link tightenGatePolicy}, where padding the unset fields with archetype defaults would
 * silently drag a deliberately-relaxed org bar back toward the default. (ci-gate 2026-07-16 #1)
 */
export function explicitPolicyFromParams(params: URLSearchParams): GatePolicy {
  const minLevel = params.get("min_level");
  const noUngoverned = params.get("no_ungoverned");
  const requireProtection = params.get("require_protection");

  // Security gate: `?security=1` (default D9 floor) or `?min_security=N` (explicit floor). Both pin a
  // per-dimension floor on Security (D9) AND forbid the "ungoverned" posture — the security policy.
  // An out-of-range/empty/0 min_security is dropped (undefined) so it neither requests an impossible
  // floor nor is mistaken for "floor=0"; `?security=1` still falls back to DEFAULT_SECURITY_MIN.
  const minSecurity = floorParam(params, "min_security");
  const wantSecurity = params.get("security") === "1" || params.get("security") === "true" || minSecurity !== undefined;

  const pol: GatePolicy = {};
  if (isLevelId(minLevel)) pol.minLevel = minLevel;
  const minOverall = floorParam(params, "min_overall");
  if (minOverall !== undefined) pol.minOverall = minOverall;
  const minDimension = floorParam(params, "min_dimension");
  if (minDimension !== undefined) pol.minDimension = minDimension;
  if (wantSecurity) pol.minDimensionFor = { [SECURITY_DIM]: minSecurity ?? DEFAULT_SECURITY_MIN };
  if (noUngoverned === "1" || noUngoverned === "true" || wantSecurity) pol.forbidPostures = ["ungoverned"];
  if (requireProtection === "1" || requireProtection === "true") pol.requireProtectedBranch = true;
  // W2: `?min_ai_governed=100` is the ungoverned-AI-change gate. `?no_ungoverned_ai=1` is the
  // shorthand for the strict form, since 100 is the only value most callers want.
  const strictAi = params.get("no_ungoverned_ai");
  const minAiGoverned = floorParam(params, "min_ai_governed");
  if (minAiGoverned !== undefined) pol.minAiGovernedRate = minAiGoverned;
  else if (strictAi === "1" || strictAi === "true") pol.minAiGovernedRate = 100;
  return pol;
}

/**
 * Build a policy from URL query params, falling back to the archetype default for anything
 * unset — so the badge and CI endpoint accept e.g. `?min_level=L4&min_dimension=50&no_ungoverned=1`.
 */
export function policyFromParams(params: URLSearchParams, archetype: RepoArchetype): GatePolicy {
  const base = defaultGatePolicy(archetype);
  const p = explicitPolicyFromParams(params);
  return {
    minLevel: p.minLevel ?? base.minLevel,
    // A <=0 / >100 / fractional / invalid value falls back to the archetype default rather than
    // installing an always-pass (<=0) or unreachable (>100) floor.
    minOverall: p.minOverall ?? base.minOverall,
    minDimension: p.minDimension ?? base.minDimension,
    minDimensionFor: p.minDimensionFor ?? base.minDimensionFor,
    forbidPostures: p.forbidPostures ?? base.forbidPostures,
    requireProtectedBranch: p.requireProtectedBranch ?? base.requireProtectedBranch,
  };
}

/**
 * Combine two policies into the STRICTEST of both — the merge the UNAUTHENTICATED gate endpoint uses
 * so a query param can TIGHTEN a persisted org policy per-request but never weaken or silently drop
 * it (ambiguity-ui 2026-07-16 ci-gate #1: previously ONE policy param replaced the entire persisted
 * policy, letting any anonymous caller — or a PR author editing the workflow URL — lower the org's
 * configured bar). Field rules: numeric floors take the max; minLevel takes the higher level;
 * per-dimension floors union with a per-key max; forbidPostures union; requireProtectedBranch ORs.
 * A field neither side sets stays unset.
 */
export function tightenGatePolicy(a: GatePolicy, b: GatePolicy): GatePolicy {
  const maxOpt = (x?: number, y?: number): number | undefined =>
    x === undefined ? y : y === undefined ? x : Math.max(x, y);
  const pol: GatePolicy = {};
  const minLevel =
    a.minLevel && b.minLevel
      ? levelNum(a.minLevel) >= levelNum(b.minLevel)
        ? a.minLevel
        : b.minLevel
      : a.minLevel ?? b.minLevel;
  if (minLevel) pol.minLevel = minLevel;
  const minOverall = maxOpt(a.minOverall, b.minOverall);
  if (minOverall !== undefined) pol.minOverall = minOverall;
  const minDimension = maxOpt(a.minDimension, b.minDimension);
  if (minDimension !== undefined) pol.minDimension = minDimension;
  const dimIds = new Set([...Object.keys(a.minDimensionFor ?? {}), ...Object.keys(b.minDimensionFor ?? {})]);
  if (dimIds.size) {
    const floors: Partial<Record<DimensionId, number>> = {};
    for (const id of dimIds) {
      const floor = maxOpt(a.minDimensionFor?.[id as DimensionId], b.minDimensionFor?.[id as DimensionId]);
      if (floor !== undefined) floors[id as DimensionId] = floor;
    }
    if (Object.keys(floors).length) pol.minDimensionFor = floors;
  }
  const postures = [...new Set([...(a.forbidPostures ?? []), ...(b.forbidPostures ?? [])])];
  if (postures.length) pol.forbidPostures = postures;
  if (a.requireProtectedBranch || b.requireProtectedBranch) pol.requireProtectedBranch = true;
  // W2: strictest wins, same as every other numeric bar — a query param can raise the org's
  // provenance requirement but never lower it.
  const minAiGoverned = maxOpt(a.minAiGovernedRate, b.minAiGovernedRate);
  if (minAiGoverned !== undefined) pol.minAiGovernedRate = minAiGoverned;
  return pol;
}
