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

import type { AppPassport, PassportFinding, ProductionBand } from "@/lib/types";

// ── HELD rungs: coverage is not absence ──────────────────────────────────────────────────────────────
// The CI and security ladders are read off workflow CONTENT, which arrives through a bounded fetch.
// When the scan read less than the tree lists, the builder mints `prod.ci-unassessable` /
// `prod.security-unassessable`; this is the ONE read of that fact every consumer of the ordinal goes
// through. A rung is held when that finding stands AND the level is the floor the unread content
// could lift (CI `build`: no checks seen; security `none`/`policy`: no scanner seen). A level the read
// part already proves (CI `checks`, security `scanning`) is a measured lower bound and stays scored.
// A held rung is not scored, not ranked and not painted as a miss: the score renormalizes over the
// axes it did measure.
export type HeldRung = "ci" | "security";

const HOLD: Record<HeldRung, { code: string; floor: ReadonlySet<string> }> = {
  ci: { code: "ci-unassessable", floor: new Set(["none", "build"]) },
  security: { code: "security-unassessable", floor: new Set(["none", "policy"]) },
};

const codeOf = (f: Pick<PassportFinding, "id" | "code">): string => f.code || f.id.slice(f.id.indexOf(".") + 1);

/** True when this rung's level is a floor the scan could not see past (see HOLD above). */
export function isRungHeld(
  rung: HeldRung,
  level: string,
  findings: readonly Pick<PassportFinding, "id" | "code">[] | null | undefined,
): boolean {
  const h = HOLD[rung];
  return h.floor.has(level) && (findings ?? []).some((f) => codeOf(f) === h.code);
}

/** The level as a flat export (CSV) should print it: `unassessable` for a held rung, never its floor. */
export function levelOrHeld(
  rung: HeldRung,
  level: string,
  findings: readonly Pick<PassportFinding, "id" | "code">[] | null | undefined,
): string {
  return isRungHeld(rung, level, findings) ? "unassessable" : level;
}

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
 *  owner-override re-derivation in applyPassportOverrides). Reads `findings` for held rungs only, so a
 *  caller must pass the coverage findings beside the sub-scales. */
export function deriveProductionScore(
  pr: Omit<AppPassport["productionReadiness"], "band" | "score" | "blockers">,
): { score: number; band: ProductionBand } {
  const deliv =
    (pr.delivery.migrations === "versioned" ? 50 : pr.delivery.migrations === "scripted" ? 25 : 0) +
    (pr.delivery.iac ? 25 : 0) +
    (pr.delivery.rollback ? 25 : 0);
  // A held axis contributes nothing and its weight leaves the denominator. With nothing held the
  // expression is the unchanged weighted sum (0 + x is exact, and there is no division).
  const ciHeld = isRungHeld("ci", pr.ci.level, pr.findings);
  const secHeld = isRungHeld("security", pr.security.level, pr.findings);
  const weighted =
    (ciHeld ? 0 : 0.25 * (CI_PTS[pr.ci.level] ?? 0)) +
    0.25 * (TEST_PTS[pr.tests.level] ?? 0) +
    (secHeld ? 0 : 0.2 * (SEC_PTS[pr.security.level] ?? 0)) +
    0.15 * (OBS_PTS[pr.observability.level] ?? 0) +
    0.15 * Math.min(100, deliv);
  const measured = 1 - (ciHeld ? 0.25 : 0) - (secHeld ? 0.2 : 0);
  const score = Math.round(ciHeld || secHeld ? weighted / measured : weighted);
  const band: ProductionBand = score < 25 ? "prototype" : score < 45 ? "internal" : score < 65 ? "beta" : score < 85 ? "production" : "hardened";
  return { score, band };
}
