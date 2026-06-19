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

import { IMPORT_WATCH_SCHEDULE } from "@/components/onboarding/importScan";
import { MONTHLY_RUNS } from "@/lib/credit-estimate";

/** Upper-bound monthly run rate the onboarding watch commitment draws, per scanned repo.
 *  `?? 0` is the documented silent-zero trap the contract test guards against: if
 *  IMPORT_WATCH_SCHEDULE ever drifts out of MONTHLY_RUNS this returns 0 and the disclosure would
 *  understate a real recurring charge as free. */
export const IMPORT_WATCH_MONTHLY_RATE = MONTHLY_RUNS[IMPORT_WATCH_SCHEDULE] ?? 0;

/** Disclosed upper-bound prepaid credits/month for committing `count` repos to the onboarding watch.
 *  This is the SAME arithmetic the select step renders, so the disclosed figure tracks the
 *  committed cadence (IMPORT_WATCH_SCHEDULE) — the cost shown equals the cost the POST charges. */
export function importWatchMonthlyCredits(count: number): number {
  return count * IMPORT_WATCH_MONTHLY_RATE;
}
