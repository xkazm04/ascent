// Client-safe credit-cost arithmetic for the connect / onboarding commitment surfaces.
//
// A scheduled autoscan run on a metered (non-public) org draws ONE prepaid credit per run
// (src/lib/entitlement.ts + the cron rescan's reserve-then-refund); runs that dedupe to an
// unchanged commit or degrade to mock are refunded. These monthly figures are therefore
// clearly-labeled UPPER-BOUND estimates of the commitment being made — not a bill — surfaced
// exactly where the user flips a watch/schedule control, so the spend decision is informed.

/** Approximate scheduled runs per calendar month, keyed by the SCHEDULES ids (minus "off"). */
export const MONTHLY_RUNS: Record<string, number> = { daily: 30, weekly: 4, monthly: 1 };

/** Tooltip copy explaining the estimate's basis, shared by every surface that renders one. */
export const CREDIT_ESTIMATE_NOTE =
  "Upper-bound estimate: daily ≈30, weekly ≈4, monthly ≈1 runs per month. Runs on an unchanged commit (or degraded runs) are refunded.";

/**
 * Upper-bound prepaid credits/month the given watch+schedule states will draw. Pure — derived
 * from the SAME rows the list renders, so the figure tracks every optimistic toggle live.
 */
export function estimateMonthlyCredits(
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
