// Route-level entitlement gate for metered (private) scans, layered over the credit ledger.
//
// Policy: a scan is METERED when it runs against a real org (not the shared "public" funnel), with a
// non-mock engine, and a DB is configured to track it. Public scans are always free. The gate refuses a
// metered scan when the org is out of credits and isn't on an unlimited plan; the debit itself happens
// AFTER the scan actually produces real inference (so a cache/dedup or a degraded-to-mock run is free).
// See src/lib/db/credits.ts for the accounting and docs/features/billing/billing.md for the purchase flow.
//
// UNKNOWN TENANT vs UNKNOWN TIER — two unknowns, opposite safe defaults, deliberately not one rule.
// An unrecognised PLAN string floors to `free` in src/lib/plans.ts (planFeatures/planAllows): the
// customer sees an upsell they can complain about, which is recoverable, where over-granting is not.
// An unknown ORG is the opposite: a slug that matched no row must be REFUSED, because "floor it to
// free" would GRANT a phantom tenant the free tier's monthly allowance. The floor is safe only where
// something is known to exist. That refusal lives here (`orgExists` below) rather than in plans.ts,
// because this is the layer that actually looks the org up — plans.ts is only ever handed a string.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { isDbConfigured } from "@/lib/db/client";
import { selfHosted } from "@/lib/env";
import { getCreditState, countMeteredScansThisMonth } from "@/lib/db/credits";
import { planFeatures, resolveScanCharge, scanAllowance } from "@/lib/plans";
import type { UsageLane } from "@/lib/llm/meter";

/** True when this scan should draw on the org's prepaid credits.
 *
 *  Never on a SELF-HOSTED deployment: metering exists to recover Ascent Cloud's own LLM/infra cost,
 *  and on someone else's box that cost is already theirs. Short-circuiting HERE (rather than only in
 *  `checkScanEntitlement`) turns the whole billing path off at its root — no allowance count, no
 *  credit debit, no 402 — instead of relying on every downstream gate to independently notice.
 *  `isUnlimitedPlan`/`scanAllowance` also self-host short-circuit, so the two agree either way. */
export function isMeteredScan(orgSlug: string, mock: boolean): boolean {
  return isMeteredLane("scan", orgSlug, mock);
}

/**
 * The LANE-aware form of the predicate above (#11). Same three clauses for every lane — self-hosted is
 * never metered, persistence must be on, the keyless mock engine spent nothing, and the shared public
 * funnel is free by policy — plus one more for the non-scan lanes: a lane is metered only when the
 * plan has explicitly opted it in through `PlanFeature.laneAllowances`, and no tier does today.
 *
 * There is deliberately NO second self-hosted floor here: this delegates to the same `selfHosted()`
 * short-circuit `isUnlimitedPlan`/`scanAllowance` read, so there is one switch to keep correct rather
 * than two that can disagree. `isMeteredScan` above delegates in turn, so every existing scan call
 * site is byte-identical.
 */
export function isMeteredLane(lane: UsageLane, orgSlug: string, mock: boolean, plan?: string | null): boolean {
  if (selfHosted()) return false;
  if (!(isDbConfigured() && !mock && orgSlug !== PUBLIC_ORG)) return false;
  if (lane === "scan") return true;
  return planFeatures(plan).laneAllowances?.[lane] !== undefined;
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
