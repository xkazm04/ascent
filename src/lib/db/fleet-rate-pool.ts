// The ONE fold that turns per-repo (or per-scan) PR rates into a fleet rate.
//
// The analyzer publishes every rate twice: a bare rounded percentage, and a qualified count over the
// rate's own population (`PrStats.rates`, pr-thresholds.ts) with the sample floor declared beside it.
// The fleet layer used to throw the second away and average the first, weighted by `analyzed`. For
// the analyzed-denominated rates that is close to harmless; for review coverage (population:
// human-authored merged PRs) and AI governance (population: AI-involved PRs) it is a different metric.
// A 100-PR repo with 10 human merges outvoted a 10-PR repo with 10 human merges ten to one, so 1 of 10
// plus 10 of 10 published as 18% instead of the 11 of 20 (55%) the fleet actually did.
//
// The rule here: POOL (sum of counts over sum of populations, floored by RATE_BASIS.minSample on the
// POOLED population) when every contributor persisted the book for that rate; otherwise keep the old
// analyzed-weighted mean, unchanged, and say how many contributors forced it. No partial pool: a
// pool missing a repo is a smaller fleet that still looks complete. getOrgPrSignals and
// buildDeliveryTrend both fold through here, so the headline and the trend cannot disagree.
//
// `merge`, `aiTrailer` and `aiPreReviewed` have no persisted counts, so only `volumeWeighted` applies
// to them. org-rework.ts carries a third copy of the weighted fold; it has no consumer today and is
// deliberately left on its own arithmetic.

import { qualifiedRate, ratePercent, type RateBasisId } from "@/lib/analyze/pr-thresholds";

/** The fleet rates the rate book can pool: each is both a `FleetRateId` and a `RateBasisId`. */
export type PoolableRateId = "smallPr" | "aiInvolved" | "revert" | "reviewed" | "aiGoverned";
export const POOLABLE_RATE_IDS: readonly PoolableRateId[] = ["smallPr", "aiInvolved", "revert", "reviewed", "aiGoverned"];

/** How a fleet rate was computed. `volume-weighted` is the legacy mean over `analyzed`. */
export type FleetRateMethod = "pooled" | "volume-weighted";

export interface RateCounts {
  count: number;
  population: number;
}

/** One repo's (or one scan's) say in a fleet rate. */
export interface RateContribution {
  /** Analyzed PRs: the legacy weight. */
  analyzed: number;
  /** The scalar percentage the scan published. Null = "no sample", never a measured 0. */
  percent: number | null;
  /** The rate's own denominator when known without the book (e.g. `analyzed` for smallPr). Only the
   *  volume-weighted basis reads it; absent or null = not persisted. */
  population?: number | null;
  /** The qualified counts from the rate book; null for a scan that predates the book. */
  counts: RateCounts | null;
}

export interface FleetRatePool {
  percent: number | null;
  method: FleetRateMethod;
  /** Analyzed PRs summed over the contributing repos (the weight, when volume-weighted). */
  weight: number;
  /** Repos that contributed a measurement. */
  repos: number;
  /** Pooled numerator. Null when volume-weighted: a mean of percentages has no count. */
  count: number | null;
  /** Pooled (or, when volume-weighted, summed-where-known) denominator. Null = not persisted. */
  population: number | null;
  /** Contributors whose scan predates the book for this rate: the reason a rate is not pooled. */
  legacyRepos: number;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The book's counts for one rate, or null when the book, the entry, or a sane pair is missing.
 *  Takes any `RateBasisId` (not only the fleet's five) so a reader of selfApproved / fastApproval
 *  pools through the same guard. */
export function bookCounts(book: unknown, id: RateBasisId): RateCounts | null {
  if (!book || typeof book !== "object") return null;
  const entry = (book as Record<string, unknown>)[id];
  if (!entry || typeof entry !== "object") return null;
  const { count, population } = entry as { count?: unknown; population?: unknown };
  if (!finite(count) || !finite(population)) return null;
  if (count < 0 || population < 0 || count > population) return null;
  return { count, population };
}

/** The legacy fold: mean of the scalar percentages weighted by analyzed PRs, "no sample" skipped. */
export function volumeWeighted(contributions: readonly RateContribution[]): {
  percent: number | null;
  weight: number;
  repos: number;
  population: number | null;
} {
  let weight = 0;
  let sum = 0;
  let repos = 0;
  // Stays a number only while every contributor persisted a denominator: a sum missing a term is a
  // smaller denominator that still looks complete.
  let population: number | null = 0;
  for (const c of contributions) {
    if (c.percent == null) continue;
    weight += c.analyzed;
    sum += c.percent * c.analyzed;
    repos += 1;
    population = c.population == null || population == null ? null : population + c.population;
  }
  return { percent: weight > 0 ? Math.round(sum / weight) : null, weight, repos, population: repos ? population : null };
}

/** Fold one book-carrying rate across the fleet: pooled when every contributor has the book. Any
 *  `RateBasisId` works; the fleet band pools the five `POOLABLE_RATE_IDS`. */
export function poolFleetRate(id: RateBasisId, contributions: readonly RateContribution[]): FleetRatePool {
  const legacyRepos = contributions.filter((c) => c.counts == null).length;
  if (!contributions.length || legacyRepos > 0) {
    return { ...volumeWeighted(contributions), method: "volume-weighted", count: null, legacyRepos };
  }
  let count = 0;
  let population = 0;
  let weight = 0;
  let repos = 0;
  for (const c of contributions) {
    const k = c.counts!;
    count += k.count;
    population += k.population;
    if (k.population > 0) {
      repos += 1;
      weight += c.analyzed;
    }
  }
  // ratePercent owns the floor (RATE_BASIS[id].minSample, at least 1), applied to the POOL: two repos
  // each under the floor can clear it together, and a pool under it is null, never 0.
  return { percent: ratePercent(qualifiedRate(id, count, population)), method: "pooled", weight, repos, count, population, legacyRepos: 0 };
}
