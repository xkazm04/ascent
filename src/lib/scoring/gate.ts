// Maturity Gate — turn a maturity report into an enforceable pass/fail policy (à la SonarQube
// Quality Gates / OpenSSF Scorecard thresholds). evaluateGate() checks a configurable policy
// and returns the specific failing conditions; defaults are archetype-aware (a solo repo is
// held to a lower bar than an org/platform). Consumed by the public CI endpoint.

//
// THE POLICY-SOURCE CONTRACT (docs/resolutions/gate-as-code.md, option A). Ascent has ONE policy
// type and ONE merge. A new source of gate policy — an org row, a per-repo admission decision, a
// repo-declared manifest bar, a query param — produces a `GatePolicy` and NOTHING ELSE, and the
// gate resolves them as one ordered strictest-wins fold:
//
//   effective = tighten(tighten(tighten(org ?? archetype, admission), manifest), params)
//
// Nothing in the chain can WEAKEN what precedes it, which is why the unauthenticated endpoint can
// safely accept every layer. A new bar is therefore FOUR edits and never a fifth resolution path:
//   (1) the `GatePolicy` field, (2) a `sanitizeGatePolicy` clause (untrusted -> clean),
//   (3) a `tightenGatePolicy` rule (strictest wins), (4) a `describeGatePolicy` row —
// plus either an absolute input on `NormalizedGate` or an honest-null skip there. `gate.test.ts`
// holds this as a table-driven structural guard, so a field added without its four places fails.

import type { DimensionId, LevelId, Posture, RepoArchetype, ScanReport, ScanSensorId } from "@/lib/types";
import { LEVELS, DIMENSION_BY_ID } from "@/lib/maturity/model";
import { parseFloor } from "@/lib/scoring/gate-numeric";
import { isValidCheckId, type CheckLevel } from "@/lib/standard/check-ids";

/** The Security dimension + the default floor a security gate holds it to (`?security=1`). */
const SECURITY_DIM: DimensionId = "D9";
export const DEFAULT_SECURITY_MIN = 50;

/** Ceiling on `requireChecks`. A policy is untrusted input (a DB column, an admission fragment); a
 *  10k-entry list would turn every gate evaluation into a scan of it. */
export const MAX_REQUIRE_CHECKS = 100;

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
  /**
   * ADMISSION (#8). No AI-attributed change may land at all — the policy fragment a repo admitted in
   * `mode: "blocked"` compiles to. Distinct from `minAiGovernedRate: 100` ("AI work must be approved"):
   * this says AI work must not be here.
   *
   * ONLY ENFORCED WHEN MEASURABLE, the same fail-OPEN exception `minAiGovernedRate` documents and for
   * the same reason: `aiInvolvedRate` is null with no token and null under the PR-sample floor, and a
   * repo with no observable AI activity must not be blocked by an AI policy. Null -> SKIPPED, and
   * `evaluateGateLite` (whose snapshot carries no PR stats) skips it always rather than inventing a
   * verdict the CI gate would not also reach.
   */
  forbidAiAuthorship?: boolean;
  /**
   * CONTROLS (#16). Doctor check ids that must not be REPORTED FAILING. Union-merged, exactly like
   * `forbidPostures` — a second source can add a required check, never drop one.
   *
   * Honest-null skip, three ways, because a control gate that invents failures is worse than none:
   *   - `checkStates === null` (the repo has never reported a conformance run, or the caller has no
   *     ledger to read) -> every named check is SKIPPED. The measurement was never due.
   *   - a named check absent from the latest report -> `unchecked`, which is a RESULT, not a pass and
   *     not a failure. Skipped.
   *   - `unchecked` / `warn` / `pass` -> no failure. Only an explicit `fail` fails the gate.
   */
  requireChecks?: string[];
}

export interface GateFailure {
  code:
    | "level"
    | "overall"
    | "dimension"
    | "posture"
    | "governance"
    | "provenance"
    | "incomplete"
    /** #8 — an admission decision (a blocked repo with observed AI authorship). */
    | "admission"
    /** #16 — a `requireChecks` control the repo's own doctor reports failing. */
    | "control";
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
  "This scan is INCOMPLETE: no dimension could be scored (every detector failed or returned no data), " +
  "so its 0 / L1 result is not a measurement. The gate fails closed rather than certify or condemn a " +
  "repository on an ingestion failure; re-scan or check repository access.";

/**
 * A criterion the gate COULD NOT TEST on this run, named on every surface.
 *
 * WHY THIS TYPE EXISTS (quality-gates/unmeasurable-criteria). Four criteria skip on an honest null —
 * `requireProtectedBranch` (governance unreadable), `minAiGovernedRate` / `forbidAiAuthorship` (no PR
 * stats) and `requireChecks` (no conformance ledger). Skipping is right; skipping SILENTLY is not.
 * `describeGatePolicy` renders an untested bar into the policy echo, the PR footer and the audit row
 * identically to an enforced one, so a `200 pass` with `policy.requireProtectedBranch: true` read as
 * "this repo has a protected default branch" when the truth was "nobody looked".
 *
 * That reading is not rare, it is the DEFAULT on the public endpoint: `GET /api/gate` scans with
 * `noAmbientToken`, `scan-ingest` gates `pullRequests` and `branchGovernance` behind a token, so
 * `governance` and `prStats` are ALWAYS null there — `?require_protection=1`, `?min_ai_governed=N`
 * and `?no_ungoverned_ai=1` are unconditionally inert on that surface. A condition skipped for most
 * of the population has become advisory by data starvation, and the only defence is to COUNT it.
 *
 * `code` is the same vocabulary as {@link GateFailure.code}, so one criterion has one name across the
 * verdict, the skip list and the telemetry.
 */
export interface GateSkip {
  code: "governance" | "provenance" | "admission" | "control";
  /** Plain sentence naming what could not be read, and why that is a skip rather than a pass. */
  why: string;
}

/** Reader-facing name of each skippable criterion — one label, shared by every surface. */
export const GATE_SKIP_LABEL: Record<GateSkip["code"], string> = {
  governance: "Protected default branch",
  provenance: "AI-governed change rate",
  admission: "AI authorship (admission)",
  control: "Reported controls",
};

export interface GateResult {
  pass: boolean;
  policy: GatePolicy;
  failures: GateFailure[];
  /**
   * Every configured criterion this run could not evaluate. EMPTY is a claim: it says every bar in
   * `policy` was actually tested. Never contains a criterion the policy does not set (an unset bar is
   * not "unmeasured", it is not asked for).
   */
  skipped: GateSkip[];
  /**
   * What the SCAN ITSELF says about its own reliability, read by the gate rather than left in the
   * report (quality-gates/gate-liveness — "a gate that cannot prove it ran has not run").
   *
   * A scan whose governance or securityPosture sensor THREW was byte-identical, to every line of gate
   * code, to one where the signal was legitimately absent: both collapse to null, null is scored as
   * absence, and the verdict came out a full-confidence green Check Run. `isIncompleteReport` caught
   * only the total wipeout. These are the partial ones, said out loud.
   *
   * Never a verdict of its own: a caveat qualifies a pass/fail, it does not become one. Empty on a
   * scan that reports nothing wrong with itself.
   */
  caveats: string[];
}

/**
 * The coverage floor below which this gate adds a caveat. It is the SCAN's own number
 * (`buildScanWarnings` warns under 0.5 coverage), deliberately: two different "low coverage" lines
 * disagreeing about where low starts would be worse than one.
 */
export const GATE_CONFIDENCE_FLOOR = 0.5;

/** Reader-facing name of each sensor — mirrors scan-compose's SENSOR_LABEL so the gate names the READ
 *  the same way the scan's own warning does. */
const GATE_SENSOR_LABEL: Record<ScanSensorId, string> = {
  pullRequests: "pull requests",
  governance: "branch governance",
  securityPosture: "security posture",
  securityExposure: "dependency exposure",
  appInventory: "installed-App inventory",
  ciHealth: "CI health",
  deployments: "deployments",
};

/**
 * WHICH FAILED SENSOR TURNS WHICH CRITERION INTO A SKIP.
 *
 * Only the two criteria whose ENTIRE input is one sensor are listed, and that is the whole rule: a
 * criterion that can be skipped is one whose input either exists or does not. The SCORE bars are
 * deliberately absent — `securityPosture` failing makes D9 understate, but a `min_security` floor on
 * an understated D9 must stay FAIL-CLOSED (that is the point of a floor), and converting it to a skip
 * would turn some failing verdicts into passes. Those sensors are reported as a caveat instead, which
 * is the honest shape: the bar was tested, against a signal that is missing part of its evidence.
 */
const SENSOR_SKIPS: Partial<Record<ScanSensorId, GateSkip["code"][]>> = {
  governance: ["governance"],
  pullRequests: ["provenance", "admission"],
};

/** The honesty flags a scan carries about itself, in the shape the gate reads them. */
interface GateHonesty {
  sensorFailures: readonly ScanSensorId[];
  confidence?: number;
  warnings?: readonly string[];
  prPartial?: boolean;
}

/**
 * The scan's own reliability caveats, as gate-voice sentences. Pure, and exported so every surface
 * (check run, sticky comment, API body) renders the SAME list rather than each re-reading the report.
 */
export function buildGateCaveats(h: GateHonesty): string[] {
  const out: string[] = [];
  const failed = [...h.sensorFailures].filter((id) => GATE_SENSOR_LABEL[id]);
  if (failed.length) {
    out.push(
      `GitHub signal reads FAILED during this scan (${failed.map((id) => GATE_SENSOR_LABEL[id]).join(", ")}). ` +
        "The checks those reads feed are missing, not absent from the repository, so any bar that depends on them " +
        "was judged against incomplete evidence.",
    );
  }
  if (typeof h.confidence === "number" && Number.isFinite(h.confidence) && h.confidence < GATE_CONFIDENCE_FLOOR) {
    out.push(
      `Only ~${Math.round(h.confidence * 100)}% of the repository could be inspected, below the ${Math.round(
        GATE_CONFIDENCE_FLOOR * 100,
      )}% coverage floor the scan itself flags. Treat this verdict as indicative rather than authoritative.`,
    );
  }
  // The report's OWN words, quoted rather than paraphrased: if the scan already says its coverage is
  // low or its tree was truncated, the verdict repeats that sentence instead of inventing a second
  // wording for the same fact.
  for (const w of h.warnings ?? []) {
    if (/coverage|truncated/i.test(w)) out.push(`The scan reports: ${w}`);
  }
  if (h.prPartial) {
    out.push(
      "Pull-request data was INCOMPLETE on this scan (GitHub returned a truncated page), so the Review, Velocity " +
        "and Delivery dimensions understate — a score bar on those was judged low by a read that did not finish.",
    );
  }
  return out;
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
  /**
   * The criterion this condition compiles to, when that criterion can be SKIPPED (see {@link GateSkip}).
   * Present so a renderer can mark an untested bar in the same enumeration it renders it from — the
   * policy echo stays complete, and the bars that were never tested say so. Absent for the score bars,
   * which are always evaluated (a non-finite score is a FAIL, never a skip).
   */
  code?: GateSkip["code"];
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
    out.push({ text: "Default branch must be protected", bit: "protected branch", query: ["require_protection", "1"], ci: `require-protection: 'true'`, code: "governance" });
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
      code: "provenance",
    });
  }
  if (p.forbidAiAuthorship) {
    // No `query`/`ci`: admission is a decision the ORG records, never something an anonymous caller
    // or a workflow file asks for. It reaches the fold only through the admission overlay.
    out.push({
      text: "No AI-attributed change may land in this repository (admission: blocked)",
      bit: "no AI authorship",
      code: "admission",
    });
  }
  if (p.requireChecks?.length) {
    const checks = p.requireChecks;
    out.push({
      text: `Reported controls must not be failing: ${checks.join(", ")}`,
      bit: `controls ${checks.length === 1 ? checks[0] : `(${checks.length})`}`,
      code: "control",
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
  // #8. Strictly `=== true`: a truthy "1"/"yes" from a hand-edited JSON column must not install the
  // strictest bar in the file by accident, the same rule requireProtectedBranch keeps above.
  if (r.forbidAiAuthorship === true) pol.forbidAiAuthorship = true;
  // #16. Only well-formed check ids survive; an unknown-but-valid id is KEPT (spec principle 3 — a
  // newer doctor may invent checks), a malformed one is dropped rather than stored as a bar that can
  // never be satisfied. Deduped and sorted so two equivalent policies serialize identically.
  if (Array.isArray(r.requireChecks)) {
    const checks = [...new Set(r.requireChecks.filter((c): c is string => typeof c === "string" && isValidCheckId(c)))].sort();
    if (checks.length) pol.requireChecks = checks.slice(0, MAX_REQUIRE_CHECKS);
  }
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
  /**
   * Whether branch governance was READ at all on this run. The two falsy states of `governanceEnforce`
   * are not the same thing and used to be indistinguishable: "readable and protected" is a criterion
   * that PASSED, "unreadable" is a criterion that was never tested. Only the second is a {@link GateSkip},
   * and telling them apart is the whole point — the public endpoint scans token-less, so it is ALWAYS
   * the second one there.
   */
  governanceReadable: boolean;
  /** The exact governance-failure message for this shape (report names the branch; lite is generic). */
  governanceMessage: string;
  /** Why the protected-branch criterion could not be tested, when it could not — the {@link GateSkip}
   *  sentence. Per-shape because the reasons differ (a token-less public scan vs a rollup row that
   *  carries no protection column) and a skip that cannot say WHY is barely better than silence. */
  governanceSkipWhy: string;
  /** Why the two PR-derived criteria could not be tested, when they could not. Same reasoning. */
  prSkipWhy: string;
  /**
   * The scan's own list of sensors whose read THREW (`ScanReport.sensorFailures`). A criterion whose
   * input sensor is in here is skipped as "read FAILED", which is a different sentence from "not read"
   * and a much more important one: it says the signal exists and we could not see it. Empty on a shape
   * that carries no such record (the fleet rollup), which is UNKNOWN, never "nothing failed".
   */
  sensorFailures: readonly ScanSensorId[];
  /**
   * Share (0..100) of AI-attributed merged PRs that carried an approving human review, or NULL when
   * unmeasurable (no token, or under the ≥5 AI-PR sample floor). Null SKIPS `minAiGovernedRate` —
   * see the policy field's doc for why an unmeasurable repo must not fail this bar.
   */
  aiGovernedRate: number | null;
  /** How many AI PRs backed that rate, for the failure message. */
  aiPrSample: number | null;
  /**
   * #8 — share (0..100) of analyzed PRs that are AI-involved, or NULL when unmeasurable. The input
   * `forbidAiAuthorship` reads: null (or 0) SKIPS the rule. See that policy field for why the
   * admission bar fails OPEN on an unmeasurable repo while every score criterion fails closed.
   */
  aiInvolvedRate: number | null;
  /**
   * #16 — the latest conformance report's per-check levels, or NULL when the repo has never reported
   * (or the caller has no ledger to read). Null SKIPS every `requireChecks` entry; an id absent from a
   * non-null map is `unchecked`, which is also a skip. Only an explicit `fail` fails.
   */
  checkStates: Record<string, CheckLevel> | null;
}

/**
 * Run every criterion, returning what FAILED and what could not be TESTED.
 *
 * THE SPLIT, stated once because it is the rule that decides which list an unusable input lands in:
 *
 *  - A NON-FINITE SCORE IS A FAILURE, NEVER A SKIP. `minLevel`, `minOverall` and both dimension-floor
 *    sweeps fail closed on missing/NaN input: an unscored dimension means the measurement BROKE, and
 *    a gate that skipped it would let the exact Security or Testing bar it exists to enforce be
 *    bypassed by absence of data.
 *  - AN HONEST NULL IS A SKIP. `requireProtectedBranch` (governance unreadable), `minAiGovernedRate`
 *    and `forbidAiAuthorship` (no PR stats) and `requireChecks` (no ledger / an unchecked control)
 *    are the four criteria whose null means the measurement was never DUE, not that it broke. They
 *    skip — and every skip is NAMED here, because the alternative (today's silence) publishes an
 *    untested bar in `policy` as though it had been enforced.
 *
 * A skip is only ever recorded for a bar the policy actually SETS: an unset criterion is not
 * unmeasured, it was not asked for.
 */
function evaluateNormalized(g: NormalizedGate, pol: GatePolicy): { failures: GateFailure[]; skipped: GateSkip[] } {
  const failures: GateFailure[] = [];
  const skipped: GateSkip[] = [];
  /** The failed sensor a criterion's input came from, when one failed. */
  const failedSensorFor = (code: GateSkip["code"]): ScanSensorId | null => {
    for (const [sensor, codes] of Object.entries(SENSOR_SKIPS)) {
      if (codes.includes(code) && g.sensorFailures.includes(sensor as ScanSensorId)) return sensor as ScanSensorId;
    }
    return null;
  };
  /** "read failed" beats "not read": a scan that TRIED and threw must not be reported as one that
   *  never had a token. Falls back to the shape's own not-measured sentence. */
  const skipWhy = (code: GateSkip["code"], fallback: string): string => {
    const sensor = failedSensorFor(code);
    return sensor
      ? `The ${GATE_SENSOR_LABEL[sensor]} read FAILED during this scan, so this rule was NOT TESTED. A failed read is not a pass — re-run the gate, or check the token's access.`
      : fallback;
  };

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
        message: `The maturity level is unscored: failing the required ${pol.minLevel} (fail-closed).`,
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
        : `Overall score is unscored: failing the required ${pol.minOverall} (fail-closed).`,
    });
  }
  if (typeof pol.minDimension === "number") {
    const min = pol.minDimension;
    for (const d of g.dims.filter((x) => belowFloor(x.score, min))) {
      failures.push({
        code: "dimension",
        message: Number.isFinite(d.score)
          ? `${d.id} ${d.name} scored ${d.score}, below the required ${min}.`
          : `${d.id} ${d.name} is unscored: failing the ${min} floor (fail-closed).`,
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
            : `${d.id} ${d.name} is unscored: failing the ${floor} floor (fail-closed).`,
        });
      }
    }
  }
  if (pol.forbidPostures?.some((p) => p === g.posture.id)) {
    failures.push({ code: "posture", message: `Posture "${g.posture.label}" is not permitted by the gate.` });
  }
  // Governance: only enforce when readable (a token saw the rules) so a no-token scan never false-fails.
  // Unreadable is now SAID rather than silently passed — on the unauthenticated endpoint that is every
  // single call, so `policy.requireProtectedBranch: true` beside a 200 was the most load-bearing
  // untested bar in the product.
  if (pol.requireProtectedBranch) {
    // Order matters and is fail-closed: an observed unprotected branch is still a FAILURE even if
    // some other sensor failed. Only the two non-failing outcomes can become a skip, so a failed read
    // can never turn a red verdict green — it can only stop a green one from being claimed.
    if (g.governanceEnforce) failures.push({ code: "governance", message: g.governanceMessage });
    else if (!g.governanceReadable || failedSensorFor("governance"))
      skipped.push({ code: "governance", why: skipWhy("governance", g.governanceSkipWhy) });
  }
  // PROVENANCE (W2): were AI-attributed changes actually reviewed by a human before merge?
  //
  // Deliberately NOT fail-closed, which is the opposite of every criterion above — and the exception
  // is principled. The other criteria fail closed because an unscored dimension means the measurement
  // BROKE. Here, null means the measurement was never DUE: the repo had no token, or fewer than five
  // AI PRs in the window. Failing those would block every repo with little AI activity from merging,
  // on a policy whose entire purpose is to govern repos that have a lot of it.
  if (typeof pol.minAiGovernedRate === "number" && g.aiGovernedRate == null) {
    skipped.push({ code: "provenance", why: skipWhy("provenance", g.prSkipWhy) });
  } else if (typeof pol.minAiGovernedRate === "number" && g.aiGovernedRate != null) {
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
  // ADMISSION (#8). Same fail-OPEN exception as the provenance rule directly above, for the same
  // reason: an unmeasurable repo (`aiInvolvedRate == null`) or one with no observed AI activity at
  // all has not violated an AI-authorship policy. Blocking it would hold every quiet repo to a bar
  // its data cannot even test — and this criterion arrives from an admission row on an
  // UNAUTHENTICATED endpoint, so a false positive here is the most expensive kind of wrong.
  if (pol.forbidAiAuthorship && g.aiInvolvedRate == null) {
    // Null is unmeasurable; ZERO is measured and clean, so only the first is a skip.
    skipped.push({ code: "admission", why: skipWhy("admission", g.prSkipWhy) });
  }
  if (pol.forbidAiAuthorship && g.aiInvolvedRate != null && g.aiInvolvedRate > 0) {
    failures.push({
      code: "admission",
      message:
        `${Math.round(g.aiInvolvedRate)}% of analyzed PRs are AI-attributed, but this repository's admission ` +
        `decision is "blocked": no AI-attributed change may land here.`,
    });
  }
  // CONTROLS (#16). Three honest-null skips, all of which mean "the measurement was never due":
  // no ledger at all, no report naming this check, or a report that named it `unchecked`.
  if (pol.requireChecks?.length) {
    const states = g.checkStates;
    for (const check of pol.requireChecks) {
      if (!states) {
        skipped.push({
          code: "control",
          why: `"${check}" was not judged: this repository has reported no conformance run to read (\`node .ai/doctor.mjs --json\`), so no control state exists.`,
        });
        continue;
      }
      const state = states[check];
      if (state === undefined || state === "unchecked") {
        skipped.push({
          code: "control",
          why: `"${check}" was not judged: the latest conformance report reports it as \`unchecked\` — a result, not a pass.`,
        });
        continue;
      }
      if (state !== "fail") continue;
      failures.push({
        code: "control",
        message: `The control "${check}" is reported FAILING by this repository's own conformance run; the gate requires it to pass.`,
      });
    }
  }

  return { failures, skipped };
}

/**
 * Criteria inputs a `ScanReport` structurally cannot carry, supplied by whichever caller HAS them.
 * Kept as one optional bag rather than a second evaluator so `evaluateNormalized` stays the single
 * place gate rules run (the property this module exists to hold). Omitting the bag is the honest
 * default: every field in it degrades to a documented skip, never to a pass.
 */
export interface GateInputs {
  /**
   * #16 — the latest conformance report's per-check levels for THIS repo. Null/absent = the caller
   * has no ledger (no DB, no org, no report), so `requireChecks` is skipped rather than guessed.
   */
  checkStates?: Record<string, CheckLevel> | null;
  /**
   * THE SCAN'S OWN HONESTY FLAGS, overridable by the caller. `evaluateGate` defaults every one of
   * these from the report it was handed — a caller has to do nothing to get the honest reading — and
   * a caller that holds a better record (a persisted row whose `sensorFailures` survived, a
   * reconstructed report) can supply it. Undefined means "use the report's own"; an empty array means
   * "nothing failed", which is a different claim.
   */
  sensorFailures?: readonly ScanSensorId[];
  /** 0..1 repo coverage. Below {@link GATE_CONFIDENCE_FLOOR} the verdict carries a caveat. */
  confidence?: number;
}

/** Evaluate a report against a policy (defaults to the archetype policy), listing every failure. */
export function evaluateGate(report: ScanReport, policy?: GatePolicy, inputs: GateInputs = {}): GateResult {
  const pol = policy ?? defaultGatePolicy(report.archetype);
  // Read the report's own reliability record FIRST, so it is attached to every verdict this function
  // can return — including the incomplete short-circuit below, where the caveats are the most useful
  // thing on the response.
  const sensorFailures = inputs.sensorFailures ?? report.sensorFailures ?? [];
  const caveats = buildGateCaveats({
    sensorFailures,
    confidence: inputs.confidence ?? report.confidence,
    warnings: report.warnings,
    prPartial: report.prPartial,
  });
  // An unscorable scan short-circuits: running the criteria would emit a wall of "D1 scored 0" style
  // failures that read as findings about the repository, when the only true statement is that nothing
  // was measured. One honest failure instead. (G3-10)
  if (isIncompleteReport(report)) {
    return { pass: false, policy: pol, failures: [{ code: "incomplete", message: INCOMPLETE_MESSAGE }], skipped: [], caveats };
  }
  const { failures, skipped } = evaluateNormalized(
    {
      // `|| 0` aligns the malformed-level parse with evaluateGateLite's (a bogus level id → NaN → 0
      // → fail-closed under any minLevel), so the two evaluators agree on corrupt input.
      level: levelNum(report.level.id) || 0,
      levelLabel: `Overall level ${report.level.id}`,
      overall: report.overallScore,
      posture: { id: report.posture.id, label: report.posture.label },
      dims: report.dimensions.map((d) => ({ id: d.id, name: d.name, score: d.score })),
      governanceEnforce: !!(report.governance?.readable && !report.governance.protected),
      governanceReadable: !!report.governance?.readable,
      governanceMessage: `Default branch "${report.governance?.defaultBranch}" has no branch-protection rules: the gate requires a protected default branch.`,
      governanceSkipWhy:
        "Branch protection was NOT READ on this scan, so the rule was not tested. The public gate endpoint " +
        "scans without a token and branch governance needs one — this bar is only enforceable on the GitHub " +
        "App check run (or a scan with a token).",
      prSkipWhy:
        "Pull-request signals were NOT MEASURED on this scan (no token, or fewer than five AI-attributed PRs " +
        "in the window), so the rule was not tested rather than passed.",
      // W2: null on a token-less scan (no prStats at all) AND under the engine's own ≥5 AI-PR floor,
      // which is exactly the "not measurable" the provenance rule skips on.
      aiGovernedRate: report.prStats?.aiGovernedRate ?? null,
      aiPrSample: report.prStats ? Math.round((report.prStats.aiInvolvedRate / 100) * report.prStats.analyzed) : null,
      // #8: null on a token-less scan — the admission rule skips rather than blocking a repo whose AI
      // activity nobody could observe.
      aiInvolvedRate: report.prStats?.aiInvolvedRate ?? null,
      // #16: a full ScanReport carries no conformance ledger (the reports are org-scoped rows, not a
      // scan artifact), so a caller that has one threads it in through `inputs`. Everything else —
      // the CLI, a test, an anonymous gate on an org with no ledger — honestly skips.
      checkStates: inputs.checkStates ?? null,
      sensorFailures,
    },
    pol,
  );
  return { pass: failures.length === 0, policy: pol, failures, skipped, caveats };
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
  const { failures, skipped } = evaluateNormalized(
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
      governanceReadable: !!snap.govReadable,
      governanceMessage: "Default branch has no branch-protection rules: the gate requires a protected default branch.",
      governanceSkipWhy: "The fleet rollup carries no branch-protection reading for this repository, so the rule was not tested.",
      prSkipWhy: "The fleet rollup carries no pull-request statistics for this repository, so the rule was not tested.",
      // Parity with evaluateGate: a rollup that doesn't carry the rate leaves it undefined → skipped,
      // so the fleet view never invents a provenance failure the CI gate wouldn't also raise.
      aiGovernedRate: snap.aiGovernedRate ?? null,
      aiPrSample: snap.aiPrSample ?? null,
      // #8: the lite snapshot has no PR stats at all, so `forbidAiAuthorship` is ALWAYS skipped here
      // and the fleet view reports it as unobserved rather than as a pass. Inventing a rate from the
      // rollup would let the dashboard condemn a repo the CI gate would clear — the exact drift this
      // shared evaluator exists to prevent.
      aiInvolvedRate: null,
      // #16: likewise no ledger in a rollup row. Skipped, never green.
      checkStates: null,
      // A rollup row carries no record of which sensors failed during the scan it summarizes. EMPTY is
      // the only honest value here and it means UNKNOWN, not "nothing failed" — which is why the fleet
      // view must not present its verdicts as more reliable than the CI gate's.
      sensorFailures: [],
    },
    policy,
  );
  return { pass: failures.length === 0, policy, failures, skipped, caveats: [] };
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
 * unset — so the CI endpoint accepts e.g. `?min_level=L4&min_dimension=50&no_ungoverned=1`.
 *
 * DEFECT D10 (BACKLOG group-05), fixed here: this function used to hand-list SIX fields, and
 * `minAiGovernedRate` was not one of them. `explicitPolicyFromParams` parsed `?min_ai_governed=90` /
 * `?no_ungoverned_ai=1` correctly and this function then DROPPED it — on the no-org-policy path,
 * which is every self-hosted deployment, every DB-less one, and every repo whose org has not set a
 * bar. The strictest criterion in the product silently did nothing exactly where nothing else was
 * enforcing it. It matters twice over now: an admission overlay is folded in through this same path,
 * and an overlay whose fields are dropped is an overlay that means nothing.
 *
 * The fix is written as "the explicit policy wins, the archetype default fills the gaps" over the
 * WHOLE object rather than as a seventh hand-listed line, so the next `GatePolicy` field cannot
 * reintroduce the same drop. `gate.test.ts` holds that as a structural guard over every key.
 */
export function policyFromParams(params: URLSearchParams, archetype: RepoArchetype): GatePolicy {
  const base = defaultGatePolicy(archetype);
  const p = explicitPolicyFromParams(params);
  // Spread order is the precedence: every field the params explicitly set overrides the archetype
  // default; every field they did not set keeps it. `explicitPolicyFromParams` only ever assigns keys
  // it actually parsed (it never writes `undefined`), so a spread cannot erase a base field.
  return { ...base, ...p };
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
  // #8: ORs, like requireProtectedBranch — an admission fragment can forbid AI authorship, and a
  // second layer can never un-forbid it.
  if (a.forbidAiAuthorship || b.forbidAiAuthorship) pol.forbidAiAuthorship = true;
  // #16: UNION, like forbidPostures — a layer adds required controls, never removes them.
  const checks = [...new Set([...(a.requireChecks ?? []), ...(b.requireChecks ?? [])])].sort();
  if (checks.length) pol.requireChecks = checks.slice(0, MAX_REQUIRE_CHECKS);
  return pol;
}
