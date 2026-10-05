// The period delta's BASIS, composed once for every briefing renderer.
//
// WHY THIS MODULE EXISTS. The briefing's headline period delta used to be
// `mean(current fleet) - mean(baseline fleet)`, which folds two independent effects into one number
// labelled as movement: a fleet that onboarded five low-scoring repositories mid-quarter read as
// "slipping" an amount no repository experienced, and one that onboarded strong repositories
// manufactured a climb nobody earned. The cohort-matched figure the delta should be was already
// computed on the same rollup object (`CohortMovement`, src/lib/db/org-rollup.ts) and already read by
// the Overview tab and the weekly digest; the board-facing briefing was the one surface still
// subtracting population means.
//
// A delta is now read off that cohort, and a COUNT TRAVELS WITH ITS PREDICATE: "+6 points" over 4
// matched repositories out of 60 renders identically to "+6" over 58 unless the cohort size ships
// beside the figure. The briefing prints the delta on four surfaces (the tile, the board PDF, the
// "Copy for LLM" markdown and the public share page), so the caption lives HERE rather than in any of
// them: four hand-rolled captions is four chances to drop the denominator on the one artifact that
// leaves the building unedited.
import type { CohortMovement } from "@/lib/db/org-rollup";
import type { ExecBriefing } from "./briefing";

/** The briefing fields a movement caption is composed from - nothing else may be consulted. */
type MovementSource = Pick<ExecBriefing, "periodDelta" | "periodMovement">;

/** The cohort-matched movement a briefing may state, or null when there is none to qualify. Absent
 *  (an older serialized briefing) is read as null: no cohort is known, so no claim is made about one. */
export function briefingPeriodMovement(b: Pick<ExecBriefing, "periodMovement">): CohortMovement | null {
  return b.periodMovement ?? null;
}

const repos = (n: number) => `${n} repositor${n === 1 ? "y" : "ies"}`;

/**
 * The composition change the cohort matching correctly EXCLUDED, as its own figure. Null when the
 * population did not change - "0 onboarded" in a board caption is noise, and the clause's whole value
 * is that it appears exactly when something was left out of the delta.
 */
export function periodCompositionClause(m: CohortMovement | null): string | null {
  if (!m || (m.onboarded === 0 && m.departed === 0)) return null;
  const parts: string[] = [];
  if (m.onboarded > 0) parts.push(`${repos(m.onboarded)} onboarded`);
  if (m.departed > 0) parts.push(`${repos(m.departed)} departed`);
  return `${parts.join(" and ")} inside this period are excluded from it: their move would be a lifetime change, not this period's.`;
}

/**
 * THE caption every surface prints beside the period delta: the matched denominator, plus the
 * composition change when there was one.
 *
 * Null when there is no delta to qualify (no baseline, or no repository scanned on both sides of the
 * window) - the renderers then show no delta badge either, because a delta over an empty cohort is
 * not a measurement of anything, and a 0 in its place reads as "no change".
 */
export function periodDeltaCaption(b: MovementSource): string | null {
  const m = briefingPeriodMovement(b);
  if (!m || b.periodDelta == null) return null;
  const clause = periodCompositionClause(m);
  return `Measured over ${repos(m.cohortSize)} scanned on both sides of this period.${clause ? ` ${clause}` : ""}`;
}

/**
 * The "vs previous period" grid's honesty line. That block differences two INDEPENDENTLY POPULATED
 * windows (end state against end state), so when the two were measured over different denominators
 * the difference is a standing comparison and not movement - and it must say so, carrying both
 * denominators, rather than borrowing the vocabulary of the cohort-matched delta above it.
 *
 * Null when the denominators match (nothing to disclose) or when either is unknown.
 */
export function priorPeriodBasisNote(nowScored?: number | null, priorScored?: number | null): string | null {
  if (nowScored == null || priorScored == null || nowScored === priorScored) return null;
  return `Standing comparison, not movement: ${repos(nowScored)} live-scored in this period vs ${priorScored} in the previous period, so this difference also reflects which repositories were measured.`;
}
