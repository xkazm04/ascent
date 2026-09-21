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
// STUB — WP5 implements. Signatures are final.

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

/** The constraints this comparison declares, before it runs. */
export function declaredConstraints(): Constraint[] {
  return [];
}

export function buildComparisonReport(_lanes: unknown[], _constraints?: Constraint[]): ComparisonReport {
  throw new Error("buildComparisonReport: not implemented (WP5)");
}
