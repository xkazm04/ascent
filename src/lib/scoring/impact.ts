// Canonical impact ordering/weight — the ONE place high/medium/low map to a numeric rank. Pure data,
// client- and server-safe (no db or runtime imports), so the UI (backlog sort, roadmap priority),
// the onboarding leverage scorer, and the db rollups can all import one source instead of re-typing
// the `{ high: 3, medium: 2, low: 1 }` literal. (org-shared.ts re-exports this as IMPACT_WEIGHT, its
// string-keyed alias for the rollup queries' `?? n` fallbacks.)

/** high=3, medium=2, low=1 — bigger is more impactful. Typed string-keyed so callers that index by a
 *  plain `string` impact (with a `?? 0`/`?? 1` fallback) share it without a cast. */
export const IMPACT_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
