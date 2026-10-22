// The ONE tier-revocation decision every downgrade path asks: subscription.revoked, the immediate
// subscription.canceled, and a full refund of a plan order. Pure, no I/O, so the rule is pinned in one
// place instead of hand-copied per handler (two copies drifted: only one wrote the Subscription row).
//
// Rule (registry plan-entitlements, "remove only what this conferred"): a grant records its source in
// Subscription.stripeId; a revocation is scoped to that source. Order of the checks:
//   1. A LIVE grantor (row status "active") that is a different subscription -> retain ("replaced").
//      The dying subscription was already superseded, e.g. cancel-then-resubscribe or a plan change
//      bought as a new subscription; its revoke must not strip the tier the replacement pays for.
//   2. The current tier outranks what the dying subscription conferred -> retain ("override"), e.g. a
//      hand-set enterprise via /api/org/plan. This also covers grantor-unknown rows (no Subscription
//      row, an inactive row, or a dying order with no subscription): the pre-existing rank guard.
//   3. Otherwise downgrade. The caller floors to free and marks the Subscription row inactive.

import { PLAN_ORDER, type PlanId } from "@/lib/plans";

// Subscription statuses that still ENTITLE the org to its paid tier. `past_due` keeps access during
// Polar's payment-retry window (the tier is revoked only once retries are exhausted -> `subscription.
// revoked`), and `trialing` is a live trial. Anything else (canceled / unpaid / incomplete[_expired])
// means the customer is not currently owed the tier.
export const ENTITLING_SUB_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);

/** Our own Subscription row vocabulary (not Polar's): the grant writes "active", a revoke "inactive".
 *  Only an "active" row names a live grantor. */
export const SUBSCRIPTION_ROW_STATUSES = ["active", "inactive"] as const;
export type SubscriptionRowStatus = (typeof SUBSCRIPTION_ROW_STATUSES)[number];

/** Rank of a stored plan string in the upgrade order; unknown/blank ranks as free (0). */
export function planRank(plan: string | null | undefined): number {
  const i = PLAN_ORDER.indexOf((plan ?? "") as PlanId);
  return i >= 0 ? i : 0;
}

/** Whether an order's embedded subscription still entitles the buyer to a paid tier. A one-time order
 *  carries no subscription (null) - nothing to reconcile against, so it entitles. A subscription that has
 *  already ended (endedAt set) never entitles regardless of its status label. */
export function subscriptionEntitlesTier(
  sub: { status?: string | null; endedAt?: Date | null } | null | undefined,
): boolean {
  if (!sub) return true; // one-time / legacy order with no subscription - can't prove it's lapsed
  if (sub.endedAt) return false; // already ended
  return ENTITLING_SUB_STATUSES.has(String(sub.status ?? ""));
}

export interface TierRevocationInput {
  /** The subscription whose revoke/cancel/refund arrived; null for a one-time plan order. */
  dyingSubId: string | null;
  /** The tier the dying subscription/order conferred. */
  dyingPlan: string;
  current: {
    /** The org's current Organization.plan. */
    plan: string | null;
    /** Subscription.stripeId: the Polar subscription that granted the current tier, if recorded. */
    grantingSubId: string | null;
    /** Subscription.status. Omitted means the caller asserts the grantor is live. */
    grantingStatus?: string | null;
  };
}

export type TierRevocationDecision =
  | { action: "downgrade"; reason: "grantor" | "rank" }
  | { action: "retain"; reason: "replaced" | "override"; plan: string | null; grantingSubId: string | null };

export function decideTierRevocation(input: TierRevocationInput): TierRevocationDecision {
  const { dyingSubId, dyingPlan, current } = input;
  const grantorLive = current.grantingSubId != null && (current.grantingStatus ?? "active") === "active";
  if (grantorLive && dyingSubId != null && current.grantingSubId !== dyingSubId) {
    return { action: "retain", reason: "replaced", plan: current.plan, grantingSubId: current.grantingSubId };
  }
  if (planRank(current.plan) > planRank(dyingPlan)) {
    return { action: "retain", reason: "override", plan: current.plan, grantingSubId: current.grantingSubId };
  }
  return { action: "downgrade", reason: grantorLive && current.grantingSubId === dyingSubId ? "grantor" : "rank" };
}
