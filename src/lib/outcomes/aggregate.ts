// Measured-lift distributions over the InterventionOutcome ledger — the PURE half (moonshot #9).
//
// The ledger holds measured facts only: one row per intervention whose before/after bookends both
// exist AND were produced by the same instrument. This module folds those rows into distributions a
// roadmap can cite ("closed D2 by +11 across 37 measured closes"), under two rules that are the whole
// point of the design:
//
//  1. PARTITION BY INSTRUMENT FIRST. A median taken across a rubric bump is not a measurement of the
//     repos — it is a measurement of the ruler changing. rubricVersion + engineProvider are part of
//     the partition key, never a field averaged over.
//  2. A PARTITION BELOW ITS FLOOR IS ABSENT FROM THE MAP, not present with nulls. A caller cannot
//     render a distribution it is not allowed to see, because it never receives one. This is the
//     structural form of G4 (honest nulls): under-evidence degrades to nothing, never to "+0".
//
// No Prisma, no React, no `@/lib/db` — client-importable on purpose, so the report surface and the
// server reader share one implementation of "what counts as enough evidence".

/** One ledger row, reduced to what an aggregate is allowed to see. */
export interface OutcomeSample {
  /** Tenant the row belongs to. Corpus scope counts DISTINCT orgs; org scope never mixes them. */
  orgId: string;
  identityKey: string;
  /** Honest null = a whole-scan outcome (a sandbox scenario), never "dimension 0". */
  dimId: string | null;
  overallDelta: number;
  /** Null when the dimension was absent on either bookend — excluded, never read as 0. */
  dimDelta: number | null;
  rubricVersion: string;
  engineProvider: string;
  /** Copied from Repository.isPrivate at write time. The corpus filter reads THIS, not a live lookup. */
  isPrivateRepo: boolean;
}

/**
 * Minimum measured samples before an ORG-scoped partition is publishable. 3 is `GAP_MIN_REPOS`'
 * reasoning (src/lib/db/org-insights.ts): two points is an anecdote and a single outlier owns the
 * median; three is the smallest set where a median is a median rather than a midpoint.
 */
export const OUTCOME_MIN_SAMPLES = 3;

/**
 * Minimum DISTINCT orgs before a CORPUS-scoped partition is publishable — `COHORT_MIN`'s value and
 * `COHORT_MIN`'s reason. Below five tenants a "cohort" statistic is re-identifiable: a participant who
 * knows their own number can solve for a named competitor's. Sample count is not a substitute; one
 * enthusiastic org with 40 rows is still one org.
 */
export const OUTCOME_MIN_ORGS = 5;

/** A publishable distribution for one identity × dimension × instrument. */
export interface LiftDistribution {
  identityKey: string;
  dimId: string | null;
  /** Measured samples behind every number here. Always ≥ the scope's floor. */
  n: number;
  /** Distinct orgs behind those samples. */
  orgs: number;
  /** Median per-dimension movement. Null when NO sample carried a dimDelta — never 0. */
  medianDim: number | null;
  p25: number | null;
  p75: number | null;
  /** Median overall-score movement. Always present: every ledger row carries an overallDelta. */
  medianOverall: number;
  /** The instrument this partition was measured under. Part of the key, not an average. */
  instrument: { rubricVersion: string; engineProvider: string };
}

export type LiftScope = "org" | "corpus";

/** The partition key: identity × dimension × instrument. Exported so a reader can key a lookup. */
export function liftKey(
  identityKey: string,
  dimId: string | null,
  instrument: { rubricVersion: string; engineProvider: string },
): string {
  return `${identityKey}::${dimId ?? "-"}::${instrument.rubricVersion}|${instrument.engineProvider}`;
}

/** Sorted ascending. Even-length median is the midpoint of the two centres (may be a half point). */
function median(sorted: number[]): number {
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/**
 * Nearest-rank percentile: the smallest observed value at or above the p-th rank. Deliberately NOT
 * interpolated — every number in a basis clause should be a value some repo actually recorded, so a
 * reader comparing the clause against their own ledger finds the number there.
 */
function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

interface Partition {
  identityKey: string;
  dimId: string | null;
  instrument: { rubricVersion: string; engineProvider: string };
  overall: number[];
  dim: number[];
  orgs: Set<string>;
}

/**
 * Fold measured outcomes into publishable distributions.
 *
 * `scope: "org"` — the caller has already constrained the rows to one tenant; the floor is
 * {@link OUTCOME_MIN_SAMPLES} measured samples and nothing leaves the tenant.
 *
 * `scope: "corpus"` — cross-tenant. EVERY private-repo sample is dropped before partitioning (a
 * private repo never contributes to a public statistic, not even anonymously — its presence is itself
 * disclosure), and a partition additionally needs {@link OUTCOME_MIN_ORGS} distinct orgs. This scope
 * is designed, tested and deliberately UNWIRED: cross-tenant publication needs the consent model and
 * publication contract from the open-benchmark-corpus concept doc. Nothing in `src/` calls it yet.
 */
export function aggregateLift(
  samples: readonly OutcomeSample[],
  opts: { scope: LiftScope },
): Map<string, LiftDistribution> {
  const corpus = opts.scope === "corpus";
  const parts = new Map<string, Partition>();

  for (const s of samples) {
    if (corpus && s.isPrivateRepo) continue;
    if (!Number.isFinite(s.overallDelta)) continue;
    const instrument = { rubricVersion: s.rubricVersion, engineProvider: s.engineProvider };
    const key = liftKey(s.identityKey, s.dimId, instrument);
    let p = parts.get(key);
    if (!p) {
      p = { identityKey: s.identityKey, dimId: s.dimId, instrument, overall: [], dim: [], orgs: new Set() };
      parts.set(key, p);
    }
    p.overall.push(s.overallDelta);
    if (s.dimDelta !== null && Number.isFinite(s.dimDelta)) p.dim.push(s.dimDelta);
    p.orgs.add(s.orgId);
  }

  const out = new Map<string, LiftDistribution>();
  for (const [key, p] of parts) {
    const n = p.overall.length;
    if (n < OUTCOME_MIN_SAMPLES) continue;
    if (corpus && p.orgs.size < OUTCOME_MIN_ORGS) continue;
    const overall = [...p.overall].sort((a, b) => a - b);
    const dim = [...p.dim].sort((a, b) => a - b);
    out.set(key, {
      identityKey: p.identityKey,
      dimId: p.dimId,
      n,
      orgs: p.orgs.size,
      medianDim: dim.length ? median(dim) : null,
      p25: dim.length ? percentile(dim, 0.25) : null,
      p75: dim.length ? percentile(dim, 0.75) : null,
      medianOverall: median(overall),
      instrument: p.instrument,
    });
  }
  return out;
}
