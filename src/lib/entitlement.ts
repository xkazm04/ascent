// Route-level entitlement gate for metered (private) scans, layered over the credit ledger.
//
// Policy: a scan is METERED when it runs against a real org (not the shared "public" funnel), with a
// non-mock engine, and a DB is configured to track it. Public scans are always free. The gate refuses a
// metered scan when the org is out of credits and isn't on an unlimited plan; the debit itself happens
// AFTER the scan actually produces real inference (so a cache/dedup or a degraded-to-mock run is free).
// See src/lib/db/credits.ts for the accounting and docs/BILLING.md for the purchase flow.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { getCreditState, countMeteredScansThisMonth } from "@/lib/db/credits";
import { resolveScanCharge, scanAllowance } from "@/lib/plans";

/** True when this scan should draw on the org's prepaid credits. */
export function isMeteredScan(orgSlug: string, mock: boolean): boolean {
  return isDbConfigured() && !mock && orgSlug !== PUBLIC_ORG;
}

export interface ScanEntitlement {
  allowed: boolean;
  unlimited: boolean;
  balance: number;
  /** True when the next metered scan is covered by the monthly allowance (free, no credit debit). */
  withinAllowance: boolean;
  /** Free metered scans LEFT in the monthly allowance (max(0, allowance − usageThisMonth)); Infinity
   *  on the unlimited plan. The batch paths cap on `balance + allowanceRemaining`, not balance alone —
   *  capping on prepaid credits only wrongly denied an org's INCLUDED free scans (a Free org with 0
   *  purchased credits but its included monthly free scans — PLAN_FEATURES.free.includedCredits,
   *  currently 5 — had every bulk scan/import skipped). */
  allowanceRemaining: number;
  /** `false` ONLY when a DB is configured and the slug matched NO org row (deletion / casing / typo).
   *  Mirrors CreditState.orgExists so a caller can 404 a phantom slug instead of trusting `allowed`.
   *  Optional so existing mocks/consumers that don't care are unaffected; treat `orgExists === false`
   *  as "confirmed missing". */
  orgExists?: boolean;
}

/**
 * Whether `orgSlug` may run a metered scan right now — under the hybrid model that's: unlimited, OR
 * under the monthly allowance, OR a positive credit balance. `withinAllowance` tells the caller the
 * scan will be free; only `!allowed` (allowance spent + no credits) is the 402. `allowanceRemaining`
 * lets a bulk caller size the batch to free-allowance + prepaid credits (not credits alone).
 */
export async function checkScanEntitlement(orgSlug: string): Promise<ScanEntitlement> {
  const state = await getCreditState(orgSlug);
  const usage = state.unlimited ? 0 : await countMeteredScansThisMonth(orgSlug);
  const charge = resolveScanCharge({ plan: state.plan, usageThisMonth: usage, balance: state.balance });
  const allowance = state.unlimited ? null : scanAllowance(state.plan);
  // A configured DB that matched NO org row (deletion / casing / typo) is an UNKNOWN organization, not a
  // real free org with monthly headroom. The write gate (consumeScanCredit) already denies + surfaces
  // orgExists:false, but this READ gate used to ignore orgExists entirely — so a phantom slug with usage
  // 0 < the free allowance reported allowed:true / withinAllowance:true, and the two gates disagreed.
  // Deny a confirmed-missing org here too (and zero its allowance) so read and write agree; a real
  // out-of-credits org still 402s via `charge === "denied"`.
  const orgExists = state.orgExists !== false;
  return {
    allowed: orgExists && charge !== "denied",
    unlimited: state.unlimited,
    balance: state.balance,
    withinAllowance: orgExists && charge === "allowance",
    allowanceRemaining: !orgExists
      ? 0
      : allowance == null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, allowance - usage),
    orgExists,
  };
}

/** 402 Payment Required with a machine-readable code + the current balance, for a paywalled scan. */
export function paymentRequired(balance: number): NextResponse {
  return NextResponse.json(
    {
      error: "This organization is out of private-scan credits. Add credits to continue.",
      code: "INSUFFICIENT_CREDITS",
      balance,
    },
    { status: 402 },
  );
}
