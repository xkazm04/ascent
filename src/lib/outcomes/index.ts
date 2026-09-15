// The intervention-outcome barrel (moonshot #9) — PURE re-exports only.
//
// `src/lib/db/outcomes.ts` is deliberately NOT re-exported here and never will be. This barrel is
// imported by client components (the roadmap's basis clause and its measured sort), and one value
// import of a `@/lib/db` symbol would drag Prisma — dns/fs/net/tls — into the browser bundle. That
// failure is `tsc`-clean and test-clean and only shows up as a broken `next build` (see memory:
// build-not-in-gate), so the boundary is stated here rather than discovered there.
//
// Server readers import `@/lib/db/outcomes` (the writer/reader) and
// `@/lib/outcomes/expected-lift-load` (the request-scoped lift map) directly.

export {
  aggregateLift,
  liftKey,
  OUTCOME_MIN_ORGS,
  OUTCOME_MIN_SAMPLES,
  type LiftDistribution,
  type LiftScope,
  type OutcomeSample,
} from "@/lib/outcomes/aggregate";
export { expectedLiftClause, measuredRank } from "@/lib/outcomes/expected-lift";
