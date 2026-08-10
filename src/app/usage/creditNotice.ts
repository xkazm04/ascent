// The /usage billing banner's state — derived from the SAME authority that issues the 402, never
// re-derived locally.
//
// UAT DANA-L1-003 (recurrence 2, confirmed live at L2). The banner used to be a local predicate:
//
//     lowBalance = creditBalance != null && (creditBalance === 0 || (billable > 0 && creditBalance <= billable))
//
// which had two defects a Character hit on the very first page load.
//
//  1. It IGNORED THE MONTHLY ALLOWANCE. A metered scan is free while the org is under
//     `scanAllowance(plan)` (plans.ts `decideScanCharge`), so a Free org with 0 purchased credits and
//     0 scans this month is NOT out of anything — it has its full included allowance. The banner said
//     "the next private scan will be refused (402)" while `AllotmentPanel` said "comfortably within
//     your 5/mo Free allotment" eight lines below. Same page, opposite claims, and the 402 the banner
//     invoked would not actually have fired.
//  2. It WAS NON-MONOTONIC IN THE BALANCE. Executing every branch at L2: (0 credits, 0 scans) → the
//     harshest alarm; (1 credit, 0 scans) → total silence. Topping up by a single credit silenced the
//     alarm without changing anything real. And since `scanCredits` is `DEFAULT 0`, the harshest state
//     was the DEFAULT STATE OF EVERY NEWLY CREATED ORG, not an edge case reached by unusual usage.
//
// Dana's cost read is why this is a trust bug and not a copy bug: "a tool that cries wolf as its
// default state trains me to scroll past the one warning that will eventually be real."
//
// The fix is not new arithmetic — it is DELETING the local arithmetic. `resolveScanCharge` is the
// single resolver that both billing gates already share (the read gate `checkScanEntitlement` and the
// write gate `consumeScanCredit`); the banner simply never asked it. Now it does, so the page can only
// warn about a refusal the billing layer would actually issue.
//
// Monotonicity is a consequence, not a rule bolted on: severity is `denied` → `low` → none as the
// balance rises, because `denied` requires the allowance to be spent AND the balance to be 0.

import { resolveScanCharge, scanAllowance } from "@/lib/plans";

/**
 * `denied` — the allowance is spent and there are no credits: the next private scan really does 402.
 * `low`    — the org is already paying per scan from a balance that won't cover the observed burn.
 */
export type CreditNoticeKind = "denied" | "low";

export interface CreditNotice {
  kind: CreditNoticeKind;
  /** Prepaid balance at the time of the read — the number the copy quotes. */
  balance: number;
  /** Free metered scans left in this month's plan allowance (0 when spent). */
  allowanceRemaining: number;
}

/**
 * Resolve the billing banner for an org, or null when there is nothing honest to warn about.
 *
 * Pure — the caller supplies the org's stored plan, its month-to-date metered usage, its prepaid
 * balance, and the period's billable count. Returns null for unlimited plans and for any org whose
 * next scan is covered (by allowance or by a comfortable balance).
 *
 * @param billableInPeriod private scans in the displayed window — the burn the `low` copy compares
 *        the remaining balance against. It affects only the `low` threshold, never `denied`.
 */
export function creditNotice(opts: {
  plan: string | null | undefined;
  unlimited: boolean;
  usageThisMonth: number;
  balance: number;
  billableInPeriod: number;
}): CreditNotice | null {
  if (opts.unlimited) return null;

  const charge = resolveScanCharge({
    plan: opts.plan,
    usageThisMonth: opts.usageThisMonth,
    balance: opts.balance,
  });

  const allowance = scanAllowance(opts.plan) ?? 0;
  const allowanceRemaining = Math.max(0, allowance - opts.usageThisMonth);

  // "allowance" (the next scan is free) and "unlimited" are covered states — silence. This is the
  // branch that used to fire on every brand-new org.
  if (charge === "allowance") return null;

  if (charge === "denied") return { kind: "denied", balance: opts.balance, allowanceRemaining: 0 };

  // charge === "credit": the org is drawing on prepaid credits. Warn only when the remaining balance
  // wouldn't cover another period at the observed burn — a positive balance with no burn behind it is
  // not news, and a warning nobody can act on is the same cry-wolf failure in a quieter register.
  if (opts.billableInPeriod > 0 && opts.balance <= opts.billableInPeriod) {
    return { kind: "low", balance: opts.balance, allowanceRemaining };
  }

  return null;
}
