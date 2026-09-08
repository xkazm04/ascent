// The copy that names a PR rate's BASIS — the denominator it was actually computed over, and how
// many repositories carried a sample.
//
// getOrgPrSignals has published `rateBasis` (per fleet rate: weight, contributing repos, summed
// population) and `PrRepoRow.population` (per-repo denominators) since the fleet-rollups work, both
// tested and, until now, consumed by nothing. The band therefore printed eight percentages under one
// "N PRs across M repos" headline that belonged to none of them: a review-coverage figure resting on
// 2 of 40 repos read as if it described all 40, and a per-repo row printed `analyzed` beside rates
// measured over human-merged PRs and AI-involved PRs.
//
// Pure string building, no JSX, so the claims are unit-testable without rendering a server tree.

import type { FleetRateBasis, FleetRateId } from "@/lib/db/org-signals";

/** What each rate's denominator IS, in the reader's words. Mirrors org-signals' ratePopulations. */
export const RATE_DENOMINATOR: Record<FleetRateId, string> = {
  merge: "decided PRs (merged + closed unmerged)",
  reviewed: "human-authored merged PRs",
  smallPr: "analyzed PRs",
  aiInvolved: "analyzed PRs",
  aiGoverned: "AI-involved PRs",
  revert: "analyzed PRs",
  aiTrailer: "merged PRs",
  aiPreReviewed: "merged PRs",
};

export interface BasisCopy {
  /** Terse, for the cell itself. */
  short: string;
  /** The full sentence, for a tooltip / screen reader. */
  full: string;
}

const n = (v: number) => v.toLocaleString();
const repoWord = (r: number) => `${r} repo${r === 1 ? "" : "s"}`;

/**
 * The basis of ONE fleet rate. Null when no repo contributed a measurement — the rate itself renders
 * "—" there, and a basis line under an em dash would only assert precision about nothing.
 *
 * A null `population` is not zero: it means at least one contributing scan never persisted that
 * denominator, so the sum would be smaller than the truth while looking complete. Say that instead of
 * substituting the fleet's `totalPrs`, which is the exact misreading this module exists to remove.
 */
export function fleetBasisCopy(id: FleetRateId, basis: FleetRateBasis | undefined): BasisCopy | null {
  if (!basis || basis.repos === 0) return null;
  const denom = RATE_DENOMINATOR[id];
  if (basis.population == null) {
    return {
      short: `basis: ${repoWord(basis.repos)}, sample size unknown`,
      full: `Measured across ${repoWord(basis.repos)}; the exact denominator (${denom}) was not persisted by every contributing scan, so it is not summed here. Weighted by ${n(basis.weight)} analyzed PRs.`,
    };
  }
  return {
    short: `basis: ${n(basis.population)} · ${repoWord(basis.repos)}`,
    full: `Measured over ${n(basis.population)} ${denom} across ${repoWord(basis.repos)} (weighted by ${n(basis.weight)} analyzed PRs).`,
  };
}

/**
 * The two hour readings are not rates and have no population: they are the unweighted MEAN OF the
 * per-repo medians, so what a reader needs is how many repos carried a median at all. Null when none
 * did — the cell already renders "—".
 */
export function medianBasisCopy(repos: number, what: string): BasisCopy | null {
  if (repos <= 0) return null;
  return {
    short: `basis: ${repoWord(repos)}`,
    full: `The unweighted mean of the per-repo median ${what}, across the ${repoWord(repos)} that recorded one — not a fleet-wide median, and not weighted by PR volume.`,
  };
}

/** The per-repo denominator of one rate, for a table cell's tooltip. Never falls back to `analyzed`. */
export function repoBasisTitle(id: FleetRateId, population: number | undefined): string {
  const denom = RATE_DENOMINATOR[id];
  return population == null
    ? `Denominator (${denom}) not persisted by this scan — rescan to state the sample size.`
    : `Over ${n(population)} ${denom}.`;
}

/** The per-repo denominator as the compact `/N` a row can carry beside the percentage. */
export function repoBasisMark(population: number | undefined): string | null {
  return population == null ? null : `/${n(population)}`;
}

/**
 * The PR section headline — COVERAGE ONLY, in unit/window form (/org redesign §2.3: a header is a
 * noun phrase, and its description states the unit, never the meaning).
 *
 * The old copy ("How systematically the fleet ships: N PRs analyzed across M repos; each rate below
 * names its own population") fused three jobs into one line. The claim about denominators is real and
 * survives — as `BASIS_HINT` on the header's `WhyChip` — but it was never the header's job, and
 * neither was the editorial lede. What is left is the one thing a reader needs at a glance: how much
 * of the fleet is behind this panel at all.
 */
export function prSectionBasisLine(totalPrs: number, repos: number): string {
  return `${n(totalPrs)} PRs analyzed · ${repoWord(repos)}`;
}

/** (D) The demoted "each rate below names its own population" — now the section header's WhyChip. */
export const BASIS_HINT =
  "These rates do not share a denominator: each cell states the population it was actually measured over, and several rest on a handful of the fleet's repos.";

/** (D) The demoted "the PRs column is the analyzed count, not every rate's population". */
export const PRS_COLUMN_HINT =
  "The PRs column is the analyzed count for that repo's latest scan — it is the denominator of the analyzed-based rates only; every other cell carries its own /N.";
