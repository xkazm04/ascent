// THE PER-ORG CREDIT CEILING FOR HOSTED LANES (ADR-0001 T2) — the money precondition of hosted
// dispatch, as a pure decision. `hosted-credits.ts` reads the facts and moves the credits; this module
// only answers "may this org spend this much, and does it pay for it".
//
// Two limits, and they are different limits on purpose:
//
//   the BALANCE      an org cannot arm lanes its prepaid credits do not cover. The debit is taken at
//                    ARM time, for the whole run, atomically — so "no headroom" is a refusal before a
//                    row exists, never a lane that discovers it mid-cycle.
//   the CEILING      a monthly cap on hosted-lane credits per org, derived from its plan. It exists
//                    because the balance does not bind everyone: an unlimited plan (enterprise) is
//                    never debited, and Ascent still pays the tokens of every lane it dispatches.
//                    The ceiling is what makes "unlimited scans" not also mean "unlimited agent spend".
//
// THE UNIT IS A RESERVATION, NOT A MEASUREMENT. A hosted lane's measured cost (`LoopRunLane.costMicros`)
// stays null until a worker reports it, and a null is unknown, not free. So a lane is charged its flat
// reservation at arm time and counted at that reservation against the ceiling. Reconciling the
// reservation with a measured cost belongs to the metering work, and needs a credits↔micros rate
// nobody has priced yet.
//
// SELF-HOSTED: no ceiling and no debit. The operator pays their own tokens, which is the reason
// `isUnlimitedPlan` already short-circuits there.
//
// THE NUMBERS BELOW ARE PLACEHOLDERS FOR AN OPERATOR PRICING DECISION. They gate nothing today:
// nothing registers a LaneDispatcher, so no hosted run can be armed on any deployment. They must be
// set deliberately before one is.

import type { PlanId } from "@/lib/plans";

/** Credits one hosted lane reserves at arm time. */
export const HOSTED_LANE_CREDITS = 10;

/** Monthly hosted-lane credit ceiling per plan (UTC calendar month). 0 = no hosted spend at all. */
export const HOSTED_MONTHLY_CEILING_CREDITS: Record<PlanId, number> = {
  free: 0,
  pro: 0,
  team: 200,
  enterprise: 1000,
};

export type HostedChargeBlock = "no-credit" | "over-ceiling";

export interface HostedChargeFacts {
  /** How many lanes the run would arm. */
  lanes: number;
  /** `isUnlimitedPlan(plan)`: never debited (enterprise, or any plan on a self-hosted deployment). */
  unlimited: boolean;
  /** The org's prepaid credit balance. */
  balance: number;
  /** Hosted-lane credits already reserved this month, by this org. */
  spentThisMonth: number;
  /** This org's monthly ceiling, or null for none (self-hosted). */
  ceiling: number | null;
}

export type HostedChargeDecision =
  | { ok: true; cost: number; debit: number }
  | { ok: false; cost: number; block: HostedChargeBlock };

/** The ceiling that applies to an org on `plan`. An unknown plan string reads as `free`: an org whose
 *  plan cannot be read gets no hosted spend, not the richest tier's. */
export function hostedMonthlyCeiling(plan: string | null | undefined, selfHostedDeployment: boolean): number | null {
  if (selfHostedDeployment) return null;
  return HOSTED_MONTHLY_CEILING_CREDITS[(plan ?? "free") as PlanId] ?? 0;
}

/**
 * Decide whether an org may arm `lanes` hosted lanes, and what it pays.
 *
 * The CEILING is checked before the BALANCE: an org past its ceiling cannot fix that by buying credits,
 * and telling it to top up would sell it something that does not help.
 */
export function decideHostedCharge(f: HostedChargeFacts): HostedChargeDecision {
  const lanes = Math.max(0, Math.trunc(f.lanes));
  const cost = lanes * HOSTED_LANE_CREDITS;
  if (f.ceiling != null && f.spentThisMonth + cost > f.ceiling) return { ok: false, cost, block: "over-ceiling" };
  if (f.unlimited) return { ok: true, cost, debit: 0 };
  if (f.balance < cost) return { ok: false, cost, block: "no-credit" };
  return { ok: true, cost, debit: cost };
}

/**
 * The dispatch-time re-check. The arm-time decision already reserved this lane, so what is asked here
 * is whether the org is STILL within its ceiling with the lane counted: it goes false when the plan
 * was downgraded after arming, or when concurrent arms overshot the ceiling's soft read.
 */
export function withinCeilingAtDispatch(spentThisMonth: number, ceiling: number | null): boolean {
  return ceiling == null || spentThisMonth <= ceiling;
}

/** Start of the UTC calendar month containing `now`: the window the ceiling counts over. */
export function hostedMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
