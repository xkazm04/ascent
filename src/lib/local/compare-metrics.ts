// THE METRIC CONTRACT, AS A MODULE RATHER THAN A PARAGRAPH.
//
// Declared BEFORE the first comparison run: exactly ONE metric is optimized, and every other metric
// is a threshold that is either cleared or not. A suite that skips this produces a row of numbers all
// wearing the same hat, and the first result that moves two of them in opposite directions gets
// settled by whoever argues best, after the fact, holding a result they like.
//
// THE OPTIMIZED METRIC HERE IS CLAUDE TOKENS PER VERIFIED POINT — the Claude-side tokens spent per
// point of verified maturity lift. Not points per hour (which rejects delegation whenever the local
// arm is slower, and it always is), and not landed-lane rate (which ignores the one axis this feature
// exists to move). The question the operator asked is "what can we offload when the Claude plan needs
// to slow down", and this number is that question written as arithmetic.
//

/** A number that cannot be printed without the population it was computed over. */
export interface Counted<T> {
  value: T;
  /** How many trials this figure covers. */
  n: number;
  /** What those trials have in common — the predicate. "all arms succeeded", "completed trials". */
  predicate: string;
}

export type ConstraintDirection = "at-most" | "at-least";

export interface Constraint {
  id: string;
  label: string;
  direction: ConstraintDirection;
  /** Declared before the run. Renegotiating it after seeing a result is the same move as choosing an
   *  aggregation after seeing the data. */
  threshold: number;
  /** Quality constraints bound the errors the system may make; operational ones decide whether a
   *  result is deployable at all. They behave identically in the verdict and are separated only so a
   *  reader can tell which kind was breached. */
  kind: "quality" | "operational";
}

export interface ConstraintVerdict {
  constraint: Constraint;
  observed: number | null;
  /** Null observed = UNMEASURED, which is never "cleared". */
  cleared: boolean | null;
}

/**
 * Reliability, reported two ways from the same trials because they answer opposite questions.
 *
 * `anyOfN` answers "is this achievable at all" — the right question when a human or the harness will
 * retry. `allOfN` answers "can this be relied upon" — the question behind letting something run
 * unattended, which is precisely what this feature proposes to do. The gap is not a rounding
 * difference: at a two-in-three per-trial rate, any-of-3 sits near 96% and all-of-3 near 30%.
 *
 * `modelled` records whether the figure was compounded from a rate (which assumes trials are
 * INDEPENDENT, and they are not when a task has a hard case the arm reliably misses) or observed from
 * the trials that actually ran.
 */
export interface Reliability {
  perTrial: Counted<number>;
  n: number;
  anyOfN: number;
  allOfN: number;
  modelled: boolean;
}

export interface ArmResult {
  armId: string;
  label: string;
  /** THE OPTIMIZED METRIC. Null when the arm produced no verified points — which is a finding, not a
   *  zero, because dividing by no points is not "infinitely efficient". */
  claudeTokensPerVerifiedPoint: number | null;
  verifiedPoints: number;
  claudeTokens: number;
  localTokens: number;
  /** Cost over every completed trial. The unconditioned primary: conditioning on the outcome selects
   *  on a post-treatment variable, so this stays even though the conditioned view reads better. */
  costAllCompleted: Counted<number | null>;
  /** Cost over the subset where EVERY arm succeeded — what it cost when the work actually got done.
   *  Its subset size is part of the number, never a footnote. */
  costConditioned: Counted<number | null>;
  reliability: Reliability;
  landed: number;
  failed: number;
  /** Lanes excluded from the metric because they edited the surface that scores them. Reported as an
   *  outcome, never dropped: a silently discarded void lane flatters the arm that produced it. */
  voided: number;
  /** Lanes whose plan could not be parsed and were parked. Counts as a failure for an arm below the
   *  capability floor — that is what makes the floor measurable. */
  parked: number;
  /** Lanes stopped by this arm's own ceiling, so a timeout is attributable rather than anonymous. */
  timedOut: number;
  belowFloor: boolean;
}

export interface ComparisonReport {
  optimized: { id: "claude-tokens-per-verified-point"; label: string; direction: "at-most" };
  constraints: ConstraintVerdict[];
  arms: ArmResult[];
  /** The arm that wins the optimized metric WITHOUT breaching a constraint. Null when every arm
   *  breached one — a large gain that breaches a declared threshold does not advance. */
  advance: string | null;
  /** Why no arm advanced, when that is the outcome. */
  note?: string | null;
}
// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE INPUT SHAPE.
//
// This file declares the NARROW INPUT IT NEEDS rather than importing the persisted row type: the
// read side projects a `LoopLaneRecord` onto this, in one place, and a column that arrives under a
// different name is then a compile error at that projection instead of an `undefined` that silently
// reads as zero. Field names match the wire contract's booked identifiers wherever one exists.
//
// The columns themselves are now committed: `transport`, `armId`, `planModel`, `voidReason`, the
// executing session's token columns and the planning session's `plan*` ones. `laneTokenAttribution`
// below is that one projection for the token halves, and it is what the optimized metric reads.

/**
 * HOW A LANE ENDED, as the metric needs to count it. Every value is REPORTED; none is dropped.
 *
 *   • `landed`     — the work was delivered.
 *   • `failed`     — it ran and did not.
 *   • `void`       — the integrity guard caught it editing the surface that scores it
 *                    (`lane-gate-diff.ts`). Excluded from the optimized metric, COUNTED as a failure.
 *   • `parked`     — its plan could not be parsed. A failure for an arm marked `belowFloor`;
 *                    otherwise reported and left out of the reliability denominator, because parking
 *                    a lane the harness could not read is not evidence about the model's work.
 *   • `timed-out`  — stopped by its own arm's ceiling, so the timeout is attributable.
 *   • `incomplete` — still running, or the run was stopped. Not a trial yet; counted nowhere.
 */
export type LaneOutcomeClass = "landed" | "failed" | "void" | "parked" | "timed-out" | "incomplete";

/** One lane, as the comparison needs it. Absent measurements are `null`, never `0` — the
 *  absent-value convention this wire contract states once for every package. */
export interface LaneMetricRow {
  laneId: string;
  /** Joins the lane back to the `Arm` that produced it (`src/lib/local/arm.ts`). */
  armId: string;
  /** The transport that EXECUTED. */
  transport: string;
  /** The PLANNING transport, when it differed; null/absent means the executing half planned too. */
  planTransport?: string | null;
  planModel?: string | null;
  model?: string | null;
  outcome: LaneOutcomeClass;
  /** Verbatim from `checkGateDiff`. Present only on a `void` lane; carried so the ledger can print
   *  WHY a lane was excluded rather than just that it was. */
  voidReason?: string | null;
  /** The arm this lane belongs to plans below the recorded capability floor. Read off the lane so a
   *  caller need not carry the arm set; any row asserting it marks the whole arm. */
  belowFloor?: boolean;
  /**
   * WHICH TRIAL THIS LANE IS AN ARM OF — the `abPairKey` generalization. Lanes sharing a key worked
   * the SAME curated batch, which is the only thing that makes "the subset where every arm
   * succeeded" and a paired verdict comparison meaningful. Null = unpaired; such a lane still counts
   * in every unconditioned figure and is simply not in the conditioned subset.
   */
  trialKey?: string | null;
  /** The EXECUTING session's tokens, verbatim from the lane row's columns of the same name. */
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** The PLANNING session's tokens, from the lane row's `plan*` columns. Absent/null = the lane never
   *  planned, or it ran before those columns existed — UNMEASURED, and never a free session. */
  planInputTokens?: number | null;
  planOutputTokens?: number | null;
  /** Explicit per-side token attribution, already projected (`laneTokenAttribution`). Set, it wins
   *  over the columns above; absent, the split is computed from them. */
  claudeTokens?: number | null;
  localTokens?: number | null;
  /** MICRO-CENTS, from the lane's own envelope. Null = the CLI reported nothing, which is not 0. */
  costMicros?: number | null;
  /**
   * Sum of POSITIVE dimension deltas across this lane's before/after scan diff, exactly as
   * `laneEconomics` defines a verified point (`src/lib/local/lane-economics.ts`). `null` when either
   * end of the pair is missing — UNMEASURED, which is not "moved nothing".
   */
  verifiedPoints?: number | null;
  /** The A/B guard's word: `verified` | `rejected` | `baseline-unavailable` | `skipped` | null. */
  verifyVerdict?: string | null;
  /** Wall clock for the whole lane, ms. The operational constraint reads this. */
  wallClockMs?: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// THE DECLARED NUMBERS.
//
// DECLARED, NOT MEASURED. Every threshold below was chosen BEFORE the first comparison run and none
// of them came out of a result. That is the entire value of writing them here: a threshold picked
// after seeing a figure is not a threshold, it is a description of the figure. They are overridable
// by the caller (`buildComparisonReport(lanes, myConstraints)`) so a different question can declare
// its own — but the override happens at the call site, in the open, and not by editing a number in
// this file once a run has come back.

/** Quality: the candidate arm must land at least this FRACTION of the Claude arm's landed rate.
 *  0.85 = a 15% relative drop is the most quality this trade may cost. Below that the operator is
 *  redoing the missing lanes by hand and the token saving is notional. */
export const LANDED_RATE_MARGIN = 0.85;

/** Quality: PAIRED verify-verdict regressions — trials where the Claude arm's lane verified and this
 *  arm's lane was rejected. Declared at ZERO because a rejection is the guard catching work that
 *  broke the repository; "a few" is not a rate anyone would accept unattended. */
export const MAX_VERIFY_REGRESSIONS = 0;

/** Operational: MEDIAN wall clock per completed lane, ms. 45 minutes. An unattended overnight window
 *  is ~8h at a concurrency of 2; at 45 min a lane that is ~20 lanes, which is a night's batch. A
 *  slower arm may still be cheaper per point and still be undeployable, which is precisely why this
 *  is a threshold and not a second optimized metric. */
export const MAX_MEDIAN_LANE_MS = 45 * 60 * 1000;

/** How many attempts the reliability figures are quoted over. Three: the number of times a person
 *  retries something before concluding it does not work. */
export const RELIABILITY_N = 3;

/** The transport whose arm is the reference every quality constraint is stated relative to. */
const REFERENCE_TRANSPORT = "claude";

export const CONSTRAINT_IDS = {
  landedRate: "landed-rate-vs-claude",
  verifyRegression: "verify-verdict-regressions",
  wallClock: "median-lane-wall-clock-ms",
} as const;

/** The constraints this comparison declares, before it runs. */
export function declaredConstraints(): Constraint[] {
  return [
    {
      id: CONSTRAINT_IDS.landedRate,
      label: `Landed-lane rate at least ${Math.round(LANDED_RATE_MARGIN * 100)}% of the Claude arm's`,
      direction: "at-least",
      threshold: LANDED_RATE_MARGIN,
      kind: "quality",
    },
    {
      id: CONSTRAINT_IDS.verifyRegression,
      label: "No paired verify-verdict regression against the Claude arm",
      direction: "at-most",
      threshold: MAX_VERIFY_REGRESSIONS,
      kind: "quality",
    },
    {
      id: CONSTRAINT_IDS.wallClock,
      label: `Median wall clock per lane under ${Math.round(MAX_MEDIAN_LANE_MS / 60000)} minutes`,
      direction: "at-most",
      threshold: MAX_MEDIAN_LANE_MS,
      kind: "operational",
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ARITHMETIC. Small, named, and each one refusing to invent a number it does not have.

const num = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

const COMPLETED: readonly LaneOutcomeClass[] = ["landed", "failed", "void", "parked", "timed-out"];
const isCompleted = (r: LaneMetricRow): boolean => COMPLETED.includes(r.outcome);

/** One session's tokens: the sum of its two counts, or null when NEITHER was reported. A half that
 *  reported nothing is unmeasured, and `0 + null` is not 0. */
function sessionTokens(input: number | null | undefined, output: number | null | undefined): number | null {
  const i = num(input);
  const o = num(output);
  return i == null && o == null ? null : (i ?? 0) + (o ?? 0);
}

/**
 * THE PROJECTION — whose tokens, from the lane row's own columns, in ONE place.
 *
 * A lane runs up to two sessions and the row records them separately: the unprefixed token columns
 * are the EXECUTING session, the `plan*` columns the PLANNING one. Each half is attributed to the
 * transport that ran it, so a split arm — Claude plans, a local model executes — contributes its
 * planning tokens to Claude and its executing tokens to local, which is the arithmetic the optimized
 * metric was defined over. This is the ONE function that reads those columns: a renamed column is a
 * compile error here rather than an `undefined` that silently reads as zero downstream.
 *
 * A side that did not run, or did not report, is `null` — never 0, and two unknowns sum to null.
 *
 * THE ONE CONSERVATISM LEFT, and it is now NARROW: when the planning half was Claude and its tokens
 * were never recorded (a lane older than the `plan*` columns), the executing envelope is attributed
 * to Claude rather than letting an unmeasured planner read as zero Claude spend. The bias still runs
 * AGAINST the arm this feature advocates, but only where the measurement is genuinely missing — a
 * measured lane is now reported as it was measured.
 */
export function laneTokenAttribution(r: LaneMetricRow): { claudeTokens: number | null; localTokens: number | null } {
  const explicitClaude = num(r.claudeTokens);
  const explicitLocal = num(r.localTokens);
  if (explicitClaude != null || explicitLocal != null) return { claudeTokens: explicitClaude, localTokens: explicitLocal };
  const exec = sessionTokens(r.inputTokens, r.outputTokens);
  const plan = sessionTokens(r.planInputTokens, r.planOutputTokens);
  const execIsClaude = r.transport === REFERENCE_TRANSPORT;
  // An absent `planTransport` means the executing half planned too — the wire contract's reading of
  // it, and what every lane before split arms actually did.
  const planIsClaude = (r.planTransport ?? r.transport) === REFERENCE_TRANSPORT;
  if (planIsClaude && plan == null && !execIsClaude) return { claudeTokens: exec, localTokens: null };
  const sides = [
    { claude: execIsClaude, tokens: exec },
    { claude: planIsClaude, tokens: plan },
  ];
  const side = (isClaude: boolean): number | null =>
    sides
      .filter((x) => x.claude === isClaude && x.tokens != null)
      .reduce<number | null>((acc, x) => (acc ?? 0) + (x.tokens as number), null);
  return { claudeTokens: side(true), localTokens: side(false) };
}

/** The attribution as the AGGREGATION consumes it. A null side contributes nothing to a sum, which is
 *  the only place an unmeasured side may become a 0 — it never becomes one on the row itself. */
function tokenSplit(r: LaneMetricRow): { claude: number; local: number } {
  const { claudeTokens, localTokens } = laneTokenAttribution(r);
  return { claude: claudeTokens ?? 0, local: localTokens ?? 0 };
}

/** Lanes whose lift the metric may credit: completed, and not voided by the integrity guard. */
const isCredited = (r: LaneMetricRow): boolean => isCompleted(r) && r.outcome !== "void";

/**
 * THE OPTIMIZED METRIC for one arm. Null when the arm produced no verified points — a FINDING, not a
 * zero and never an Infinity: dividing by no points is not "infinitely efficient", it is an arm that
 * has not been shown to move anything.
 */
function tokensPerPoint(claudeTokens: number, points: number, anyMeasured: boolean): number | null {
  if (!anyMeasured || points <= 0) return null;
  return claudeTokens / points;
}

function countedFor(rows: LaneMetricRow[], belowFloor: boolean): LaneMetricRow[] {
  // A parked lane is a FAILURE for an arm below the capability floor — that is exactly what makes the
  // floor measurable rather than permanent. For any other arm it is the harness failing to read a
  // plan, which is not evidence about the model, so it stays out of the denominator (and is still
  // reported in `parked`).
  return rows.filter((r) => isCompleted(r) && (belowFloor || r.outcome !== "parked"));
}

function reliabilityOf(rows: LaneMetricRow[], belowFloor: boolean, n = RELIABILITY_N): Reliability {
  const counted = countedFor(rows, belowFloor);
  const landed = counted.filter((r) => r.outcome === "landed").length;
  const p = counted.length ? landed / counted.length : 0;
  const perTrial: Counted<number> = {
    value: p,
    n: counted.length,
    predicate: belowFloor
      ? "completed lanes (a parked lane counts as a failure: this arm is below the capability floor)"
      : "completed lanes, excluding lanes parked for an unreadable plan",
  };

  // OBSERVED beats modelled whenever the trials are actually there: a trial in which this arm ran n
  // or more lanes answers both questions directly.
  const byTrial = new Map<string, LaneMetricRow[]>();
  for (const r of counted) {
    const key = r.trialKey ?? null;
    if (!key) continue;
    byTrial.set(key, [...(byTrial.get(key) ?? []), r]);
  }
  const repeated = [...byTrial.values()].filter((g) => g.length >= n);
  if (repeated.length > 0) {
    const anyOf = repeated.filter((g) => g.slice(0, n).some((r) => r.outcome === "landed")).length / repeated.length;
    const allOf = repeated.filter((g) => g.slice(0, n).every((r) => r.outcome === "landed")).length / repeated.length;
    return { perTrial, n, anyOfN: anyOf, allOfN: allOf, modelled: false };
  }

  // MODELLED, and said so. Compounding a per-trial rate across n assumes the trials are INDEPENDENT,
  // and they are not when a task has a hard case the arm reliably misses — so this figure is an
  // upper bound on any-of-n and a lower bound on nothing at all.
  return { perTrial, n, anyOfN: 1 - Math.pow(1 - p, n), allOfN: Math.pow(p, n), modelled: true };
}

/** Trials in which EVERY arm of this comparison landed. The conditioned cost's population. */
function fullySuccessfulTrials(rows: LaneMetricRow[], armIds: string[]): Set<string> {
  const byTrial = new Map<string, LaneMetricRow[]>();
  for (const r of rows) {
    if (!r.trialKey) continue;
    byTrial.set(r.trialKey, [...(byTrial.get(r.trialKey) ?? []), r]);
  }
  const out = new Set<string>();
  for (const [key, group] of byTrial) {
    const landedArms = new Set(group.filter((r) => r.outcome === "landed").map((r) => r.armId));
    if (armIds.every((id) => landedArms.has(id))) out.add(key);
  }
  return out;
}

/** A mean cost that CANNOT be printed without its population: the `n` is inside the value. */
function countedCost(rows: LaneMetricRow[], predicate: string): Counted<number | null> {
  const costs = rows.map((r) => num(r.costMicros)).filter((c): c is number => c != null);
  return { value: mean(costs), n: costs.length, predicate };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// CONSTRAINTS, EVALUATED AGAINST ONE CANDIDATE ARM.

interface ConstraintContext {
  arm: ArmResult;
  armRows: LaneMetricRow[];
  referenceRows: LaneMetricRow[];
  referenceArmId: string | null;
  belowFloor: boolean;
}

const landedRate = (rows: LaneMetricRow[], belowFloor: boolean): number | null => {
  const counted = countedFor(rows, belowFloor);
  return counted.length ? counted.filter((r) => r.outcome === "landed").length / counted.length : null;
};

function observe(constraint: Constraint, ctx: ConstraintContext): number | null {
  switch (constraint.id) {
    case CONSTRAINT_IDS.landedRate: {
      if (ctx.referenceArmId === null) return null;
      if (ctx.referenceArmId === ctx.arm.armId) return 1;
      const mine = landedRate(ctx.armRows, ctx.belowFloor);
      const theirs = landedRate(ctx.referenceRows, false);
      // A reference arm that landed nothing gives no ratio. UNMEASURED, never "cleared": a
      // denominator of zero is the absence of a comparison, not a passing one.
      if (mine == null || theirs == null || theirs === 0) return null;
      return mine / theirs;
    }
    case CONSTRAINT_IDS.verifyRegression: {
      if (ctx.referenceArmId === null || ctx.referenceArmId === ctx.arm.armId) return 0;
      const refByTrial = new Map<string, LaneMetricRow>();
      for (const r of ctx.referenceRows) if (r.trialKey) refByTrial.set(r.trialKey, r);
      const paired = ctx.armRows.filter((r) => r.trialKey && refByTrial.has(r.trialKey));
      if (paired.length === 0) return null;
      return paired.filter((r) => {
        const ref = refByTrial.get(r.trialKey as string);
        return ref?.verifyVerdict === "verified" && r.verifyVerdict === "rejected";
      }).length;
    }
    case CONSTRAINT_IDS.wallClock:
      return median(ctx.armRows.filter(isCompleted).map((r) => num(r.wallClockMs)).filter((v): v is number => v != null));
    default:
      // A caller's own constraint that this module cannot observe is UNMEASURED, and an unmeasured
      // constraint never clears. Silently dropping it would turn an override into a weakening.
      return null;
  }
}

function judge(constraint: Constraint, ctx: ConstraintContext): ConstraintVerdict {
  const observed = observe(constraint, ctx);
  if (observed == null) return { constraint, observed: null, cleared: null };
  const cleared = constraint.direction === "at-most" ? observed <= constraint.threshold : observed >= constraint.threshold;
  return { constraint, observed, cleared };
}

const breachOf = (verdicts: ConstraintVerdict[]): ConstraintVerdict | null =>
  verdicts.find((v) => v.cleared !== true) ?? null;

// ─────────────────────────────────────────────────────────────────────────────────────────────────

function armResult(armId: string, rows: LaneMetricRow[], all: LaneMetricRow[], armIds: string[]): ArmResult {
  const belowFloor = rows.some((r) => r.belowFloor === true);
  const credited = rows.filter(isCredited);
  const claudeTokens = credited.reduce((s, r) => s + tokenSplit(r).claude, 0);
  const localTokens = credited.reduce((s, r) => s + tokenSplit(r).local, 0);
  const measured = credited.filter((r) => num(r.verifiedPoints) != null);
  const verifiedPoints = measured.reduce((s, r) => s + (num(r.verifiedPoints) ?? 0), 0);
  const successTrials = fullySuccessfulTrials(all, armIds);
  const completed = rows.filter(isCompleted);
  const conditioned = completed.filter((r) => r.trialKey && successTrials.has(r.trialKey));
  const trialCount = new Set(all.map((r) => r.trialKey).filter(Boolean)).size;

  return {
    armId,
    label: armId,
    claudeTokensPerVerifiedPoint: tokensPerPoint(claudeTokens, verifiedPoints, measured.length > 0),
    verifiedPoints,
    claudeTokens,
    localTokens,
    costAllCompleted: countedCost(completed, "completed lanes with a reported cost — the unconditioned primary"),
    costConditioned: countedCost(
      conditioned,
      `lanes in the ${successTrials.size} of ${trialCount} trial(s) in which EVERY arm landed`,
    ),
    reliability: reliabilityOf(rows, belowFloor),
    landed: rows.filter((r) => r.outcome === "landed").length,
    failed: rows.filter((r) => r.outcome === "failed").length,
    voided: rows.filter((r) => r.outcome === "void").length,
    parked: rows.filter((r) => r.outcome === "parked").length,
    timedOut: rows.filter((r) => r.outcome === "timed-out").length,
    belowFloor,
  };
}

/**
 * THE COMPARISON.
 *
 * Arms are ranked by the ONE optimized metric, ascending (fewer Claude tokens per verified point is
 * better). The best-ranked arm that clears EVERY declared constraint advances. A large gain that
 * breaches a threshold does not advance, and no threshold moves to accommodate it.
 *
 * `report.constraints` carries the verdicts for the arm the report settled on — the advancing arm
 * when there is one, otherwise the best-ranked candidate, whose breach is the interesting one. Every
 * other arm's first breach is named in `note`, so nothing is hidden by the choice of which arm's
 * verdict row to show.
 *
 * An arm with a NULL optimized metric cannot advance: "no verified points" is a finding, and an arm
 * that has not been shown to move anything has not been shown to be cheaper at moving it either.
 */
export function buildComparisonReport(lanes: LaneMetricRow[], constraints?: Constraint[]): ComparisonReport {
  const rows = (lanes ?? []).filter((r): r is LaneMetricRow => !!r && typeof r.armId === "string");
  const declared = constraints ?? declaredConstraints();
  const armIds = [...new Set(rows.map((r) => r.armId))];
  const arms = armIds.map((id) => armResult(id, rows.filter((r) => r.armId === id), rows, armIds));

  const referenceArmId =
    armIds.find((id) => rows.some((r) => r.armId === id && r.transport === REFERENCE_TRANSPORT && (r.planTransport ?? r.transport) === REFERENCE_TRANSPORT)) ??
    null;
  const referenceRows = referenceArmId ? rows.filter((r) => r.armId === referenceArmId) : [];

  const ctxFor = (arm: ArmResult): ConstraintContext => ({
    arm,
    armRows: rows.filter((r) => r.armId === arm.armId),
    referenceRows,
    referenceArmId,
    belowFloor: arm.belowFloor,
  });

  const ranked = arms
    .filter((a) => a.claudeTokensPerVerifiedPoint != null)
    .sort((a, b) => (a.claudeTokensPerVerifiedPoint as number) - (b.claudeTokensPerVerifiedPoint as number));

  const optimized = {
    id: "claude-tokens-per-verified-point" as const,
    label: "Claude tokens per verified maturity point",
    direction: "at-most" as const,
  };

  if (ranked.length === 0) {
    const unmeasured = arms.length
      ? "No arm produced a verified point, so the optimized metric is null for every arm — a finding, not a tie. Nothing advances."
      : "No lanes were supplied, so there is nothing to compare.";
    return {
      optimized,
      constraints: arms[0] ? declared.map((c) => judge(c, ctxFor(arms[0] as ArmResult))) : [],
      arms,
      advance: null,
      note: unmeasured,
    };
  }

  const judged = ranked.map((arm) => ({ arm, verdicts: declared.map((c) => judge(c, ctxFor(arm))) }));
  const winner = judged.find((j) => breachOf(j.verdicts) === null) ?? null;
  if (winner) return { optimized, constraints: winner.verdicts, arms, advance: winner.arm.armId, note: null };

  const why = judged
    .map(({ arm, verdicts }) => {
      const b = breachOf(verdicts) as ConstraintVerdict;
      const observed = b.observed == null ? "unmeasured" : String(Math.round(b.observed * 1000) / 1000);
      return `${arm.armId}: ${b.constraint.label} (${b.constraint.direction} ${b.constraint.threshold}, observed ${observed})`;
    })
    .join("; ");
  const nullMetric = arms.filter((a) => a.claudeTokensPerVerifiedPoint == null).map((a) => a.armId);
  return {
    optimized,
    constraints: (judged[0] as (typeof judged)[number]).verdicts,
    arms,
    advance: null,
    note:
      `No arm advances: every arm breached a declared constraint — ${why}. A gain on the optimized metric does not ` +
      `buy a breach, and the thresholds were declared before the run.` +
      (nullMetric.length ? ` (${nullMetric.join(", ")} produced no verified points at all.)` : ""),
  };
}
