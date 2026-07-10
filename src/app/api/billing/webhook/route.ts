// POST /api/billing/webhook — Polar fulfilment. The Webhooks() adapter verifies the signature against
// POLAR_WEBHOOK_SECRET, then on `order.paid` we fulfil the buyer's org from the PRODUCT purchased
// (server-authoritative): a credit-pack product grants credits (POLAR_CREDIT_PACKS), a plan-tier product
// upgrades the org's plan (POLAR_PLAN_PRODUCTS → setOrgPlan), and a product mapped to both does both.
// The grant is IDEMPOTENT on the Polar order id and setOrgPlan is naturally idempotent, so an
// at-least-once webhook can retry without double-fulfilling. Subscription renewals also arrive as
// `order.paid`, so a recurring product auto-recharges credits / re-asserts the tier each billing cycle.
//
// REVOCATION (the money-OUT trust boundary): a plan tier is NOT a one-way, permanent grant. When a
// subscription is cancelled/revoked/refunded the org must fall back to `free`, or Ascent keeps serving a
// paid tier (allowance, seats, retention, BYOM/white-label) to someone who has stopped paying. Polar's
// subscription lifecycle events drive the downgrade — `subscription.revoked` (access definitively lost)
// and the immediate-cancel case of `subscription.canceled` — plus a FULL refund/chargeback of a plan
// order. All downgrades go through setOrgPlan(org, "free"), which is naturally idempotent (updateMany to
// a fixed value), so a webhook redelivery or two lifecycle events for the same cancellation converge on
// the same state without a per-event ledger key. See docs/BILLING.md + src/lib/db/credits.ts.
//
// Fails CLOSED when POLAR_WEBHOOK_SECRET is unset — no secret means no way to verify authenticity, so
// the route 503s instead of trusting an unverified body.

import { NextResponse } from "next/server";
import { Webhooks } from "@polar-sh/nextjs";
import { clawbackOrderRefund, grantCredits, setOrgPlan } from "@/lib/db";
import { creditsForProduct, planForProduct } from "@/lib/polar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const secret = process.env.POLAR_WEBHOOK_SECRET;

/** The tier an org falls back to when a paid subscription is cancelled / revoked / fully refunded.
 *  Matches lib/plans.PlanId "free" (the default everywhere in credits.ts). */
const FREE_PLAN = "free";

/** Bind an order OR subscription to an org slug: the external customer id we set at checkout, falling
 *  back to the checkout/subscription metadata. Both carry the org slug; either being present is enough.
 *  Order and Subscription payloads share this { customer, metadata } shape, so one binder serves both. */
function bindOrg(subject: {
  customer?: { externalId?: string | null } | null;
  metadata?: Record<string, unknown> | null;
}): string | null {
  const metaOrg = subject.metadata && typeof subject.metadata.org === "string" ? subject.metadata.org : null;
  return subject.customer?.externalId ?? metaOrg;
}

// Subscription statuses that still ENTITLE the org to its paid tier. `past_due` keeps access during
// Polar's payment-retry window (the tier is revoked only once retries are exhausted → `subscription.
// revoked`), and `trialing` is a live trial. Anything else (canceled / unpaid / incomplete[_expired])
// means the customer is not currently owed the tier.
const ENTITLING_SUB_STATUSES = new Set(["active", "trialing", "past_due"]);

/** Whether an order's embedded subscription still entitles the buyer to a paid tier. A one-time order
 *  carries no subscription (null) — nothing to reconcile against, so it entitles. A subscription that has
 *  already ended (endedAt set) never entitles regardless of its status label. */
function subscriptionEntitlesTier(
  sub: { status?: string | null; endedAt?: Date | null } | null | undefined,
): boolean {
  if (!sub) return true; // one-time / legacy order with no subscription — can't prove it's lapsed
  if (sub.endedAt) return false; // already ended
  return ENTITLING_SUB_STATUSES.has(String(sub.status ?? ""));
}

/**
 * Drop an org bound to a plan subscription back to the free tier. Shared by the revoke / immediate-cancel
 * / full-refund paths. Only acts when the subscription's product is a KNOWN plan product — a revoke for an
 * unrecognised subscription (or a deployment that doesn't sell plans via Polar) must not nuke an org's
 * tier (e.g. a hand-set `enterprise` via /api/org/plan). setOrgPlan(free) is idempotent, so this is safe
 * to apply twice (redelivery) and safe to have both `revoked` and `canceled` fire for one cancellation.
 * A missing org is logged, not thrown: there's no entitlement to revoke and a redelivery can't conjure one.
 */
async function downgradeSubscription(
  sub: {
    id: string;
    productId?: string | null;
    customer?: { externalId?: string | null } | null;
    metadata?: Record<string, unknown> | null;
  },
  cause: string,
): Promise<void> {
  const plan = planForProduct(sub.productId);
  if (!plan) {
    // Not a plan-tier subscription (or POLAR_PLAN_PRODUCTS unset) — nothing tier-related to revoke.
    console.warn(`[billing/webhook] ${cause} for subscription ${sub.id}: product ${sub.productId ?? "?"} is not a plan product; no downgrade`);
    return;
  }
  const org = bindOrg(sub);
  if (!org) {
    console.warn(`[billing/webhook] ${cause} for subscription ${sub.id}: no org bound; cannot downgrade`);
    return;
  }
  const ok = await setOrgPlan(org, FREE_PLAN);
  if (!ok) {
    console.warn(`[billing/webhook] ${cause} for subscription ${sub.id}: org "${org}" not found; downgrade skipped`);
    return;
  }
  console.info(`[billing/webhook] ${cause}: "${org}" downgraded to ${FREE_PLAN} (subscription ${sub.id}, was ${plan})`);
}

export const POST = secret
  ? Webhooks({
      webhookSecret: secret,
      onOrderPaid: async (payload) => {
        const order = payload.data;
        const credits = creditsForProduct(order.productId);
        const plan = planForProduct(order.productId);
        if (credits <= 0 && !plan) {
          // A paid order for a product that isn't a known credit pack OR plan-tier product. Not an
          // error — just nothing to fulfil. Logged so a product-map misconfig is visible rather than
          // silently dropping a real purchase.
          console.warn(
            `[billing/webhook] order ${order.id}: product ${order.productId ?? "?"} is neither a credit pack nor a plan product; skipping`,
          );
          return;
        }
        const org = bindOrg(order);
        // A real, paid order that can't be fulfilled YET must be RETRIED, not silently dropped: the
        // @polar-sh adapter responds 200 on a normal return (telling Polar "delivered"), so any `return`
        // here permanently loses the purchase. Throw instead — the adapter surfaces a non-2xx and Polar
        // redelivers under its at-least-once guarantee. The credit grant is idempotent on
        // `polar:${order.id}` and setOrgPlan is naturally idempotent, so a later successful retry can't
        // double-fulfil. Causes: the order.paid webhook racing ahead of org-row creation, or a transient
        // DB blip resolving the org.
        if (!org) {
          throw new Error(`[billing/webhook] order ${order.id}: no org bound — purchase unfulfilled, will retry`);
        }
        // TIER UPGRADE: a paid plan product moves the org onto its entitlement tier (monthly allowance,
        // seats, retention, BYOM/white-label). setOrgPlan is idempotent, so a subscription renewal's
        // recurring order.paid just re-asserts the tier. Applied BEFORE the grant so a product that is
        // both an upgrade and a credit seed still lands the tier even if the grant later retries.
        if (plan) {
          // STALE-PAID FENCE: webhooks retry and can arrive OUT OF ORDER, so an old renewal `order.paid`
          // can be (re)delivered AFTER the subscription was cancelled/revoked. Applying the tier from it
          // would RESURRECT a plan the customer no longer pays for — the mirror of the money leak this
          // whole file guards. Reconcile against the subscription state carried IN THIS SAME order: only
          // assert the tier when the order's subscription is still entitling (active / trialing / past_due,
          // not ended). A one-time order (no subscription) has nothing to reconcile against and applies as
          // before. LIMITATION: this catches an event whose OWN payload shows the sub already lapsed; a
          // redelivery carrying a stale *active* snapshot would still pass — a fully durable fence needs a
          // persisted per-subscription "revoked at" marker (a schema change, out of scope here). The
          // revoke/refund handlers below are the authoritative downgrade and setOrgPlan(free) is
          // idempotent, so at worst a late re-grant is re-corrected by the next lifecycle event.
          if (!subscriptionEntitlesTier(order.subscription)) {
            console.warn(
              `[billing/webhook] order ${order.id}: subscription ${order.subscription?.status ?? "?"} is not entitling — NOT applying tier ${plan} (stale / out-of-order paid)`,
            );
          } else {
            const ok = await setOrgPlan(org, plan);
            if (!ok) {
              throw new Error(`[billing/webhook] order ${order.id}: org "${org}" not found — plan ${plan} not applied, will retry`);
            }
            console.info(`[billing/webhook] order ${order.id}: set "${org}" to plan ${plan}`);
          }
        }
        if (credits > 0) {
          const balance = await grantCredits(org, credits, {
            reason: "polar",
            actor: "polar",
            externalId: `polar:${order.id}`,
          });
          if (balance === null) {
            throw new Error(`[billing/webhook] order ${order.id}: org "${org}" not found — ${credits} credits unfulfilled, will retry`);
          }
          console.info(`[billing/webhook] order ${order.id}: +${credits} credits to "${org}" (balance ${balance})`);
        }
      },
      // REVERSAL: an order.paid grant is append-only, so without this a buyer could purchase a pack,
      // spend the credits, then refund/charge back the Polar order and KEEP the credits (and the scans
      // they paid for) for free. Claw the granted credits back PROPORTIONALLY to the amount refunded —
      // a full refund reverses the whole pack; a partial refund reverses its share. `order.refundedAmount`
      // is CUMULATIVE, so one order can emit several refund events with a growing amount; we pass the
      // cumulative TARGET clawback and clawbackOrderRefund applies only the marginal share not yet
      // reversed (keyed per-event on the cumulative amount). That makes ANY sequence — sequential
      // partials, partial-then-full — reconcile to the true refunded fraction, and a redelivery can't
      // double-claw. The stored balance clamps at zero, so an already-spent balance absorbs what remains.
      //
      // For a PLAN order, a FULL refund/chargeback additionally revokes the tier (see below) — the same
      // append-only trap, closed for plans too.
      onOrderRefunded: async (payload) => {
        const order = payload.data;
        const packCredits = creditsForProduct(order.productId);
        const plan = planForProduct(order.productId);
        // Neither a credit pack NOR a plan product — nothing was ever granted, so nothing to reverse.
        if (packCredits <= 0 && !plan) return;
        const org = bindOrg(order);
        if (!org) {
          // No org binding to reconcile against; a redelivery can't fix that, so don't throw — just
          // surface it so a misrouted refund is visible.
          console.warn(`[billing/webhook] refund for order ${order.id}: no org bound; cannot reverse pack/tier`);
          return;
        }
        const gross = order.netAmount > 0 ? order.netAmount : order.totalAmount;
        const fraction = gross > 0 ? Math.min(1, Math.max(0, order.refundedAmount / gross)) : 1;
        if (packCredits > 0) {
          const targetClawback = Math.round(packCredits * fraction);
          const balance = await clawbackOrderRefund(org, order.id, targetClawback, {
            // The cumulative refunded amount distinguishes each refund EVENT for idempotency.
            eventKey: String(order.refundedAmount),
            actor: "polar",
          });
          if (balance === null) {
            console.warn(`[billing/webhook] refund for order ${order.id}: org "${org}" not found`);
          } else {
            console.info(`[billing/webhook] refund for order ${order.id}: clawed toward ${targetClawback} (cumulative refund ${order.refundedAmount}); "${org}" balance ${balance}`);
          }
        }
        // TIER DOWNGRADE on a FULL refund/chargeback of a plan order. A PARTIAL refund of a subscription
        // invoice does NOT revoke the tier — the customer still holds the subscription; access is governed
        // by the subscription.* lifecycle events. A full refund (fraction >= 1) reverses the purchase
        // entirely (the classic chargeback), so drop to free. Idempotent via setOrgPlan(free): a
        // redelivery, or a later subscription.revoked for the same cancellation, both converge on free.
        if (plan && fraction >= 1) {
          const ok = await setOrgPlan(org, FREE_PLAN);
          if (ok) {
            console.info(`[billing/webhook] full refund of plan order ${order.id}: "${org}" downgraded to ${FREE_PLAN} (was ${plan})`);
          } else {
            console.warn(`[billing/webhook] full refund of plan order ${order.id}: org "${org}" not found; downgrade skipped`);
          }
        }
      },
      // subscription.revoked — the customer has LOST ACCESS: immediate cancellation, a cancel-at-period-end
      // period that has now ELAPSED, or exhausted payment retries (status → unpaid). This is the
      // authoritative downgrade signal and it only fires when access is genuinely gone, so it will NOT
      // downgrade a customer who is still paid through month-end (that case is `subscription.canceled`
      // with cancelAtPeriodEnd=true, handled below — access retained until revoked).
      onSubscriptionRevoked: async (payload) => {
        await downgradeSubscription(payload.data, "revoked");
      },
      // subscription.canceled — a cancellation was scheduled or applied. Polar draws a hard line and we
      // encode it: cancelAtPeriodEnd === true means the customer KEEPS access until currentPeriodEnd, so
      // DO NOT downgrade now (that would strip a tier they've paid through the period for — a new bug);
      // the matching `subscription.revoked` fires when the period actually ends and performs the downgrade.
      // cancelAtPeriodEnd === false is an IMMEDIATE cancellation — access is gone now, so downgrade (this
      // overlaps with revoked, which also fires on immediate cancel; both are idempotent setOrgPlan(free)).
      onSubscriptionCanceled: async (payload) => {
        const sub = payload.data;
        if (sub.cancelAtPeriodEnd) {
          console.info(
            `[billing/webhook] subscription ${sub.id} canceled at period end — access retained until ${sub.currentPeriodEnd?.toISOString?.() ?? "period end"}; no downgrade yet`,
          );
          return;
        }
        await downgradeSubscription(sub, "canceled (immediate)");
      },
    })
  : async () => NextResponse.json({ error: "Billing webhook is not configured." }, { status: 503 });
