// How far each "Fix first" bar reaches — and, more importantly, when it must not reach at all.
//
// The band ranked three candidates 1·2·3 and then described each one in a sentence, so the reader
// had to infer from the prose whether the #1 slot was worth ten times the #3 slot or a rounding
// error. Triage ORDER and projected GAIN are two different facts and the band only ever showed the
// first. This module supplies the second.
//
// ONE unit, or the shared scale is a lie: **fleet-average points on the 0..100 maturity scale**.
//   - a regression is a loss on ONE repo, so it is divided by the compared-repo population before it
//     may sit on a fleet scale — a 9-point drop on one repo of forty is 0.2 fleet points, not 9;
//   - a behind-pace goal already names a fleet-average target on a 0..100 metric, so its remaining
//     distance is the same unit by construction;
//   - a findings queue has NO scoring model at all. That is the interesting case: the honest answer
//     is `missing`, and `rendersValue("missing")` is false, so the bar CANNOT print a 0 beside it.
//     A zero-length bar would rank the product's most action-shaped queue last on a scale it was
//     never measured on.
//
// Pure: no React, no fetch. The type-only kit import is erased at compile time (the
// controlMatrixViz.ts precedent), so this stays a server-safe `.ts` a test can call directly.

import type { VizState } from "@/components/org/viz";

export interface FixFirstImpact {
  /** Projected fleet-average points recoverable. `null` whenever `state` does not render a value. */
  gain: number | null;
  /** `measured` when the gain was computed from real endpoints; `missing` when it cannot be. */
  state: VizState;
  /** Why the bar is that length — the (D) disclosed basis, surfaced as the mark's `<title>`. */
  basis: string;
}

/** The unit every bar on the shared scale is drawn in. Stated once, in the band's WhyChip. */
export const IMPACT_UNIT = "fleet-average maturity points";

/** One decimal — the scale spans fractions of a point on any fleet bigger than a handful of repos. */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function missing(basis: string): FixFirstImpact {
  return { gain: null, state: "missing", basis };
}

/**
 * A repo's regression, converted to the fleet scale it will be drawn on.
 *
 * `comparedRepos` is `OrgMovers.comparedRepos` — repos with a REAL period baseline on both sides,
 * which is the population the fleet average would move over. Without it the division has no
 * denominator and the honest bar is a void: we know the repo lost points, not what the fleet gains.
 */
export function regressionImpact(name: string, dOverall: number, comparedRepos: number): FixFirstImpact {
  const lost = Math.abs(dOverall);
  if (!Number.isFinite(lost) || lost === 0) return missing(`${name} has no measured drop to recover.`);
  if (!Number.isFinite(comparedRepos) || comparedRepos <= 0)
    return missing(
      `${name} lost ${lost} points, but no repository in this period has a baseline on both sides, so there is no fleet population to divide that across.`,
    );
  return {
    gain: round1(lost / comparedRepos),
    state: "measured",
    basis: `Restoring ${name}'s ${lost} lost points returns ${round1(lost / comparedRepos)} ${IMPACT_UNIT} across the ${comparedRepos} repositories compared this period.`,
  };
}

/**
 * A findings queue. ALWAYS `missing`, and that is the point: findings are derived observations a
 * human decides on, and deciding one changes the queue rather than a scored dimension. There is no
 * model that turns "3 security findings" into points, so the band draws the absence.
 */
export function findingImpact(count: number, moduleLabel: string): FixFirstImpact {
  return missing(
    `${count} ${moduleLabel} finding${count === 1 ? "" : "s"} await a decision. A finding is an observation a person rules on — no scoring model turns it into maturity points, so this bar has no length rather than a length of zero.`,
  );
}

/**
 * A behind-pace goal. Its metric is one of the 0..100 fleet metrics (overall/adoption/rigor or a
 * single dimension), so `target − current` is already fleet-average points; the basis names WHICH
 * metric, because a D4 point and an overall point are the same unit on different subjects.
 */
export function goalImpact(g: {
  label: string;
  metricLabel?: string;
  target?: number;
  current?: number;
}): FixFirstImpact {
  const { target, current } = g;
  if (!Number.isFinite(target) || !Number.isFinite(current))
    return missing(`“${g.label}” is behind its pace, but its standing was not readable this period.`);
  const gap = round1((target as number) - (current as number));
  if (gap <= 0)
    return missing(`“${g.label}” is behind the pace its deadline needs while already at its target — there is no remaining distance to draw.`);
  const metric = g.metricLabel ?? "its metric";
  return {
    gain: gap,
    state: "measured",
    basis: `“${g.label}” is ${gap} ${metric} points short of its target of ${target}, measured fleet-wide.`,
  };
}

/**
 * The shared scale's upper bound: the largest computable gain in the band, or `null` when nothing in
 * it was computable. A null max means every bar is a void — the band still renders, and it renders
 * as three absences, which is a true reading of a fleet nobody has measured a baseline for.
 */
export function impactScaleMax(impacts: FixFirstImpact[]): number | null {
  const gains = impacts.flatMap((i) => (i.state !== "missing" && typeof i.gain === "number" && Number.isFinite(i.gain) ? [i.gain] : []));
  if (gains.length === 0) return null;
  return Math.max(...gains);
}
