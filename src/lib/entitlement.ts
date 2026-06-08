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
import { getCreditState } from "@/lib/db/credits";

/** True when this scan should draw on the org's prepaid credits. */
export function isMeteredScan(orgSlug: string, mock: boolean): boolean {
  return isDbConfigured() && !mock && orgSlug !== PUBLIC_ORG;
}

export interface ScanEntitlement {
  allowed: boolean;
  unlimited: boolean;
  balance: number;
}

/** Whether `orgSlug` may run a metered scan right now (unlimited plan, or a positive balance). */
export async function checkScanEntitlement(orgSlug: string): Promise<ScanEntitlement> {
  const state = await getCreditState(orgSlug);
  return {
    allowed: state.unlimited || state.balance > 0,
    unlimited: state.unlimited,
    balance: state.balance,
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
