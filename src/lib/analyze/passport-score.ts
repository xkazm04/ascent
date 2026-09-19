// Derived production score for the App Readiness Passport. Split out of passport.ts so BOTH the builder
// and the owner-override overlay can re-derive from one formula without a circular import (design §8.3 —
// derive, don't author). Pure: no IO, no clock.
//
// ── THE NO-VENDOR-BRANCHING RULE (APP_READINESS_PASSPORT.md §5.6) ────────────────────────────────────
// NOTHING IN THIS MODULE MAY BRANCH ON A VENDOR NAME. Every rung table below is keyed exclusively by the
// passport's ordinal enums; `"sentry"`, `"vercel"`, `"github-actions"` and their kin must never appear.
// The passport's whole premise is portability across stacks: the moment one rung pays out for a named
// tool, a repo scores differently for choosing a different tool that does the same job, and the artifact
// stops being comparable across a fleet. Until 0.4.0 this held only by the good behaviour of this file
// and was written down nowhere; it is now a stated rule with a test that reads this source
// (passport-score.test.ts). The guard is deliberately scoped to the SCORING module, not the repo: the
// detection layer in passport.ts legitimately must know vendor names — that is its job. Naming is fine;
// SCORING on the name is not.
//
// If you need a new criterion, add a rung to the relevant ordinal ladder and teach the detector to award
// it — never a `if (provider === "…")` here.

import type { AppPassport, ProductionBand } from "@/lib/types";

const CI_PTS: Record<string, number> = { none: 0, build: 20, checks: 45, gated: 70, delivery: 85, progressive: 100 };
const TEST_PTS: Record<string, number> = { none: 0, smoke: 25, partial: 50, substantial: 75, comprehensive: 100 };
const SEC_PTS: Record<string, number> = { none: 0, policy: 25, scanning: 50, gated: 75, "supply-chain": 100 };
const OBS_PTS: Record<string, number> = { none: 0, logs: 40, errors: 60, metrics: 80, tracing: 100 };

/** The complete set of keys this module is allowed to score on — every one an ordinal rung, not a name.
 *  Exported so the guard test can assert the tables above never grow a vendor key (the rule in the
 *  header). A new rung belongs in the matching ladder in src/lib/types.ts first. */
export const SCORED_RUNGS: Readonly<Record<"ci" | "tests" | "security" | "observability", readonly string[]>> = {
  ci: Object.keys(CI_PTS),
  tests: Object.keys(TEST_PTS),
  security: Object.keys(SEC_PTS),
  observability: Object.keys(OBS_PTS),
};

/** Derive the production score + band from the sub-scales (single source for both buildPassport and the
 *  owner-override re-derivation in applyPassportOverrides). */
export function deriveProductionScore(
  pr: Omit<AppPassport["productionReadiness"], "band" | "score" | "blockers">,
): { score: number; band: ProductionBand } {
  const deliv =
    (pr.delivery.migrations === "versioned" ? 50 : pr.delivery.migrations === "scripted" ? 25 : 0) +
    (pr.delivery.iac ? 25 : 0) +
    (pr.delivery.rollback ? 25 : 0);
  const score = Math.round(
    0.25 * (CI_PTS[pr.ci.level] ?? 0) +
      0.25 * (TEST_PTS[pr.tests.level] ?? 0) +
      0.2 * (SEC_PTS[pr.security.level] ?? 0) +
      0.15 * (OBS_PTS[pr.observability.level] ?? 0) +
      0.15 * Math.min(100, deliv),
  );
  const band: ProductionBand = score < 25 ? "prototype" : score < 45 ? "internal" : score < 65 ? "beta" : score < 85 ? "production" : "hardened";
  return { score, band };
}
