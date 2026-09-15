// The ONE definition of "which scans may be compared against each other", and the ONE set of
// population floors under a cross-tenant comparison.
//
// Extracted verbatim from `src/lib/db/org-insights.ts` (which re-exports it, so every existing
// caller and import path is unchanged) because a second consumer arrived: the exemplar diff
// (`src/lib/report/exemplar*.ts`, moonshot #34) compares one repo's evidence against a peer, the
// org's best, or the public cohort. A comparison built on a *copy* of this filter is a comparison
// that silently diverges the first time the rubric bumps or the mock rule changes — and the divergence
// is invisible, because both copies keep returning plausible numbers.
//
// PURE by construction: object literals and numbers plus `SCORING_RUBRIC_VERSION`. No Prisma client,
// no `next/*`, no clock — `BENCHMARK_ELIGIBLE` is a Prisma *where fragment*, not a query, so it is
// safe to import from a client-reachable module.

import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";

/**
 * Which scans may enter a percentile comparison.
 *
 * A percentile is a claim that two numbers were produced the same way. Two things break that, and both
 * were silently in the corpus before this filter existed:
 *
 * 1. **Engine.** A `mock` scan is the deterministic rubric with NO model nuance — the keyless/demo floor
 *    (`docs/features/scanning/llm-providers.md`). Seeded demo orgs and keyless deploys both produce them
 *    in bulk, so the corpus was partly a different scoring function, ranked as if it were a peer.
 * 2. **Rubric version.** Weights and detectors change; `SCORING_RUBRIC_VERSION` is stamped on each scan
 *    precisely so a pre-bump score is identifiable. Nothing re-bases persisted scans, so an old-rubric
 *    row is a number from a retired instrument. `null` (legacy, pre-stamping) is excluded for the same
 *    reason — unknown provenance is not evidence of comparability.
 *
 * Applied to BOTH sides: filtering only the corpus would rank this org's mock-scored repos against a
 * live-scored corpus, which is the same error mirrored.
 */
export const BENCHMARK_ELIGIBLE = {
  engineProvider: { not: "mock" },
  rubricVersion: SCORING_RUBRIC_VERSION,
} as const;

/** The rendered form of BENCHMARK_ELIGIBLE, returned with every benchmark so a percentile always
 *  travels with the basis it was computed on. */
export const CORPUS_BASIS = { rubric: SCORING_RUBRIC_VERSION, excludesMockEngine: true } as const;

/** Minimum same-language peer ORGS before a cohort percentile is statistically worth showing. */
export const COHORT_MIN = 5;

/** Minimum peer-org count before the headline percentile is worth showing — same discipline as
 *  COHORT_MIN: a 1–4 org corpus yields a confidently-wrong "you beat 100% of orgs". (Percentiles
 *  now rank org-mean vs other-org-means, so the floor counts ORGS, not repos.) */
export const CORPUS_MIN = 5;
