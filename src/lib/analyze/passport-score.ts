// Derived production score for the App Readiness Passport. Split out of passport.ts so BOTH the builder
// and the owner-override overlay can re-derive from one formula without a circular import (design §8.3 —
// derive, don't author). Pure: no IO, no clock.

import type { AppPassport, ProductionBand } from "@/lib/types";

const CI_PTS: Record<string, number> = { none: 0, build: 20, checks: 45, gated: 70, delivery: 85, progressive: 100 };
const TEST_PTS: Record<string, number> = { none: 0, smoke: 25, partial: 50, substantial: 75, comprehensive: 100 };
const SEC_PTS: Record<string, number> = { none: 0, policy: 25, scanning: 50, gated: 75, "supply-chain": 100 };
const OBS_PTS: Record<string, number> = { none: 0, logs: 40, errors: 60, metrics: 80, tracing: 100 };

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
