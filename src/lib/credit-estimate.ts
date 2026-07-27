// Client-safe credit-cost arithmetic for the connect / onboarding commitment surfaces.
//
// A scheduled autoscan run on a metered (non-public) org draws ONE prepaid credit per run
// (src/lib/entitlement.ts + the cron rescan's reserve-then-refund); runs that dedupe to an
// unchanged commit or degrade to mock are refunded. These monthly figures are clearly-labeled
// ESTIMATES of the commitment being made — not a bill — surfaced exactly where the user flips a
// watch/schedule control, so the spend decision is informed. (They are typical-month figures, not
// strict upper bounds: `daily: 30` under-counts a 31-day month by one run — see MONTHLY_RUNS.)

/** Approximate scheduled runs per TYPICAL calendar month, keyed by the SCHEDULES ids (minus "off").
 *  `daily: 30` is a round average, NOT an upper bound — a daily schedule runs 31 times in a 31-day
 *  month — so the shared copy (CREDIT_ESTIMATE_NOTE) must never claim "upper-bound" for it. */
export const MONTHLY_RUNS: Record<string, number> = { daily: 30, weekly: 4, monthly: 1 };

/** Tooltip copy explaining the estimate's basis, shared by every surface that renders one. */
export const CREDIT_ESTIMATE_NOTE =
  "Estimate for a typical month: daily ≈30 runs (a 31-day month can add one more), weekly ≈4, monthly ≈1. Runs on an unchanged commit (or degraded runs) are refunded.";

/**
 * Raw upper-bound scheduled-autoscan RUNS per month for the given watch+schedule states (before any
 * free allowance is netted out) — the "scheduled runs" figure shown beside the credit estimate. Pure —
 * derived from the SAME rows the list renders, so it tracks every optimistic toggle live.
 */
export function scheduledRunsPerMonth(
  repos: { watched?: boolean | null; schedule?: string | null }[],
): number {
  let total = 0;
  for (const r of repos) {
    if (!r.watched) continue;
    total += MONTHLY_RUNS[r.schedule ?? "off"] ?? 0;
  }
  return total;
}

/**
 * Will the readable prepaid balance cover under a month of the estimated autoscan draw? True only on a
 * metered (non-unlimited) org with a known balance and a positive monthly estimate the balance can't
 * meet. Pure — shared by the connect / onboarding watch-cost disclosure so the "covers under a month"
 * warning fires identically on both surfaces.
 */
export function isUnderAMonth(
  credit: { balance: number; unlimited: boolean } | null,
  monthlyCredits: number,
): boolean {
  return credit != null && !credit.unlimited && monthlyCredits > 0 && credit.balance < monthlyCredits;
}

/**
 * Estimated prepaid credits/month the given watch+schedule states will draw, AFTER the plan's
 * remaining free monthly allowance. A metered scan is FREE until the org exceeds its monthly allowance
 * (source of truth: PLAN_FEATURES[..].includedCredits / scanAllowance() in src/lib/plans.ts —
 * currently Free 5, Pro 100, Team 500; do NOT trust prose copies of these numbers), so the raw run
 * count overstates the credit spend by that free band —
 * e.g. a Pro org watching 3 daily repos schedules ≈90 runs that all fall inside its 100 free scans, a
 * real draw of 0, not 90. Pass `allowanceRemaining` (the org's INCLUDED free scans still left this
 * month, from checkScanEntitlement) to subtract it; the default 0 yields the raw run count — a true
 * upper bound only when the allowance is unknown.
 */
export function estimateMonthlyCredits(
  repos: { watched?: boolean | null; schedule?: string | null }[],
  allowanceRemaining = 0,
): number {
  return Math.max(0, scheduledRunsPerMonth(repos) - Math.max(0, allowanceRemaining));
}
