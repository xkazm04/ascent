// The Roadmap Sandbox's projected-vs-actual VERDICT, in one pure place (no Prisma, no React), because
// two surfaces must say the same thing about the same pair: the saved-plan bar
// (RoadmapSandboxScenarioBar.tsx) and the reconciliation note written onto each committed
// recommendation's timeline (sandbox-scenario.ts). Two copies of "5 pts short" drift; one does not.
//
// The ruler comes first. Since 2026-09-23 attribution refuses a before/after pair scored under two
// rubric versions (`sameRuler`, src/lib/maturity/attribution.ts), and the rubric moved three times in
// two days. A projection modeled under one rubric and "measured" under another is two numbers on two
// scales: calling the difference a miss blames the team for a ruler change, and calling it a win
// credits them with one. So anything but a proven same ruler is NOT COMPARABLE. An unrecorded rubric
// is unknown, never "the same": the intervention ledger (outcomes.ts `measurablePair`) refuses the
// same pair for the same reason, and the bar must not claim what the ledger will not.

/** Which rubric each end of the pair was scored under, and `sameRuler`'s three-state answer. */
export interface ScenarioRuler {
  before: string | null;
  after: string | null;
  /** `true` same ruler, `false` provably different, `null` at least one end does not record one. */
  same: boolean | null;
}

export type ScenarioVerdict =
  | { kind: "not_comparable"; reason: "rubric_changed" | "rubric_unrecorded"; before: string | null; after: string | null }
  | { kind: "exact" }
  | { kind: "ahead"; gap: number }
  | { kind: "short"; gap: number };

/** Projected vs actual, both deltas over the scenario's stored baseline. */
export function scenarioVerdict(projectedDelta: number, actual: { delta: number; ruler: ScenarioRuler }): ScenarioVerdict {
  const { ruler } = actual;
  if (ruler.same !== true) {
    return {
      kind: "not_comparable",
      reason: ruler.same === false ? "rubric_changed" : "rubric_unrecorded",
      before: ruler.before,
      after: ruler.after,
    };
  }
  const gap = Math.round(actual.delta - projectedDelta);
  if (gap === 0) return { kind: "exact" };
  return gap > 0 ? { kind: "ahead", gap } : { kind: "short", gap: -gap };
}

/** Why a verdict is not comparable, as a clause: "the scoring rubric changed (r19 to r21)". */
export function notComparableReason(v: ScenarioVerdict): string {
  if (v.kind !== "not_comparable") return "";
  if (v.reason === "rubric_changed") return `the scoring rubric changed (${v.before} to ${v.after})`;
  return "a scan does not record which scoring rubric it used";
}

/** A signed whole-point figure: +12, -4, 0. A loss keeps its sign; nothing is floored. */
export function signedPts(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${r}` : `${r}`;
}

const pts = (n: number) => `${n} pt${n === 1 ? "" : "s"}`;
const day = (iso: string) => iso.slice(0, 10);

/**
 * The note written onto a committed recommendation's timeline once the scenario's `actual` resolves.
 * Dates are ISO days, not locale strings: the note is stored once on the server and read by everyone.
 */
export function scenarioReconciliationNote(input: {
  author: string;
  projectedDelta: number;
  baselineScannedAt: string;
  actual: { delta: number; scannedAt: string; ruler: ScenarioRuler };
}): string {
  const who = input.author ? `Sandbox plan by @${input.author}` : "Sandbox plan";
  const head = `${who}, reconciled against the ${day(input.actual.scannedAt)} scan: projected ${signedPts(input.projectedDelta)}`;
  const since = `since the modeled ${day(input.baselineScannedAt)} scan`;
  const v = scenarioVerdict(input.projectedDelta, input.actual);
  if (v.kind === "not_comparable") {
    return `${head} ${since}, actual not comparable because ${notComparableReason(v)}.`;
  }
  const verdict =
    v.kind === "exact" ? "exactly as modeled" : v.kind === "ahead" ? `${pts(v.gap)} ahead of the model` : `${pts(v.gap)} short of the model`;
  return `${head}, actual ${signedPts(input.actual.delta)} ${since}, ${verdict}.`;
}
