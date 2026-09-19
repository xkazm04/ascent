// Pure cost-derivation for the onboarding watch-schedule disclosure.
//
// The select step DISCLOSES a recurring monthly credit cost at the exact moment the user commits
// the selected repos to a `watch:true, schedule:IMPORT_WATCH_SCHEDULE` autoscan (see importScan.ts).
// The disclosed figure and the committed schedule are wired through ONE constant by convention; the
// finding ("Lock the watch-schedule cost-disclosure contract") is that nothing enforces that the
// number shown to the user matches the cadence the POST charges — and that a schedule missing from
// MONTHLY_RUNS silently discloses `undefined ?? 0` (a recurring charge shown as 0 credits/month).
//
// Extracting this derivation makes both invariants testable without a render harness:
//   1. the per-month rate for the COMMITTED schedule is a defined positive number (no `?? 0` trap);
//   2. the disclosed cost == selected.size × that rate (so the copy can't drift from the commitment).
//
// Finding #1 (money-disclosure): this derivation ignored the org's remaining INCLUDED free monthly
// allowance — the SAME headroom the money-gate (canRunReal.ts) counts when it decides a Free-tier org
// qualifies for a REAL scan. So a 0-balance org with free scans left was shown the raw cadence cost and
// a false "pauses at zero" alarm at the exact moment it would convert. Both computations must now agree
// on ONE source of truth for the free allowance: we route the netting through `estimateMonthlyCredits`
// (@/lib/credit-estimate — the single allowance-subtraction rule the connect surface already uses)
// rather than re-deriving `Math.max(0, cost - allowance)` here.

import { IMPORT_WATCH_SCHEDULE } from "@/components/onboarding/importScan";
import { estimateMonthlyCredits, MONTHLY_RUNS } from "@/lib/credit-estimate";

/** Upper-bound monthly run rate the onboarding watch commitment draws, per scanned repo.
 *  `?? 0` is the documented silent-zero trap the contract test guards against: if
 *  IMPORT_WATCH_SCHEDULE ever drifts out of MONTHLY_RUNS this returns 0 and the disclosure would
 *  understate a real recurring charge as free. */
export const IMPORT_WATCH_MONTHLY_RATE = MONTHLY_RUNS[IMPORT_WATCH_SCHEDULE] ?? 0;

/** Disclosed upper-bound prepaid credits/month for committing `count` repos to the onboarding watch,
 *  AFTER the org's remaining free monthly allowance. `allowanceRemaining` is the org's INCLUDED free
 *  scans still left this month (OrgCredit.allowanceRemaining, from checkScanEntitlement) — the SAME
 *  band canRunRealScan treats as real-scan headroom, so the cost shown nets exactly what the gate
 *  qualified. Defaults to 0 (raw upper bound) so a caller that doesn't yet know the allowance — or the
 *  contract test — gets `count × rate`, unchanged. Delegates to estimateMonthlyCredits so the schedule
 *  rate (MONTHLY_RUNS) and the allowance netting stay single-sourced and can't drift from the commit. */
export function importWatchMonthlyCredits(count: number, allowanceRemaining = 0): number {
  // Every committed repo is watched on IMPORT_WATCH_SCHEDULE, so model `count` such rows and reuse the
  // shared estimator (identical to how the connect cost strip nets its allowance).
  const committed = Array.from({ length: Math.max(0, count) }, () => ({
    watched: true,
    schedule: IMPORT_WATCH_SCHEDULE,
  }));
  return estimateMonthlyCredits(committed, allowanceRemaining);
}
