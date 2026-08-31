// THE free public-scan allowance — the one number the quota enforces and the marketing copy states.
//
// Why this is its own module and not just a pair of functions inside public-scan-quota.ts: the copy
// that PROMISES the allowance (/pricing's Free card via src/lib/plans.ts, the landing FAQ's JSON-LD,
// the 429 body) must read the SAME number the gate charges against. public-scan-quota.ts pulls in
// node:crypto and the Prisma layer, so it can never be imported by plans.ts — which is imported by
// client components. A pure, dependency-free module can be, so the promise and the enforcement have
// exactly one source. `src/lib/public-scan-quota.ts` re-exports both functions for its own callers.
//
// UAT MC-B5: /pricing said "Unlimited free public scans" and "always free and unmetered" while the
// scan dialog's meter counted down from 5. A second hardcoded number in the copy is precisely the
// drift this module exists to make impossible — never re-type the allowance, call the function.
//
// Client-bundle note: only NEXT_PUBLIC_* env vars reach the browser, so a client-side read of these
// returns the DEFAULT. Every surface that states the allowance to a visitor (/pricing, the landing
// FAQ, the 429) renders on the SERVER, where the override is visible; the fallback only affects
// in-app plan chrome, which states no public-scan number.

/** The rolling window the public-scan allowance is counted over, in days. */
export const PUBLIC_SCAN_WINDOW_DAYS = 30;

/** Max free public scans per ANONYMOUS IP per rolling 30-day window — the Free plan's 5 scans/month
 *  applied to the public funnel. Env-overridable (PUBLIC_SCAN_MONTHLY_LIMIT); default 5. */
export function publicScanMonthlyLimit(): number {
  const n = Number(process.env.PUBLIC_SCAN_MONTHLY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

/**
 * Monthly allowance for a SIGNED-IN viewer, keyed per-user (IP-independent) so a signed-in user gets
 * their OWN bucket (uncoupled from a shared IP). Defaults to the same 5/month Free allowance — under
 * the subscription model the lever for more volume is a paid plan, not merely signing in.
 * Env-overridable (PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN); clamped to be no lower than the anonymous
 * limit (never grant *less*).
 */
export function signedInScanMonthlyLimit(): number {
  const n = Number(process.env.PUBLIC_SCAN_MONTHLY_LIMIT_SIGNED_IN);
  const configured = Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
  return Math.max(configured, publicScanMonthlyLimit());
}
