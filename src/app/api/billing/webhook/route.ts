// POST /api/billing/webhook — Polar fulfilment. The Webhooks() adapter verifies the signature against
// POLAR_WEBHOOK_SECRET, then on `order.paid` we fulfil the buyer's org from the PRODUCT purchased
// (server-authoritative): a credit-pack product grants credits (POLAR_CREDIT_PACKS), a plan-tier product
// upgrades the org's plan (POLAR_PLAN_PRODUCTS → setOrgPlan), and a product mapped to both does both.
// The grant is IDEMPOTENT on the Polar order id and setOrgPlan is naturally idempotent, so an
// at-least-once webhook can retry without double-fulfilling. Subscription renewals also arrive as
// `order.paid`, so a recurring product auto-recharges credits / re-asserts the tier each billing cycle.
//
// Fails CLOSED when POLAR_WEBHOOK_SECRET is unset — no secret means no way to verify authenticity, so
// the route 503s instead of trusting an unverified body. See docs/BILLING.md + src/lib/db/credits.ts.

import { NextResponse } from "next/server";
import { Webhooks } from "@polar-sh/nextjs";
import { clawbackOrderRefund, grantCredits, setOrgPlan } from "@/lib/db";
import { creditsForProduct, planForProduct } from "@/lib/polar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const secret = process.env.POLAR_WEBHOOK_SECRET;

/** Bind an order to an org slug: the external customer id we set at checkout, falling back to the
 *  checkout metadata. Both carry the org slug; either being present is enough. */
function orderOrg(order: {
  customer?: { externalId?: string | null } | null;
  metadata?: Record<string, unknown> | null;
}): string | null {
  const metaOrg = order.metadata && typeof order.metadata.org === "string" ? order.metadata.org : null;
  return order.customer?.externalId ?? metaOrg;
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
        const org = orderOrg(order);
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
        // seats, retention, BYOM/white-label). Previously NO billing path called setOrgPlan, so a paying
        // customer received credits but stayed on `free` (Pro/Team benefits unreachable by payment).
        // setOrgPlan is idempotent, so a subscription renewal's recurring order.paid just re-asserts the
        // tier. Applied BEFORE the grant so a product that is both an upgrade and a credit seed still
        // lands the tier even if the grant later retries.
        if (plan) {
          const ok = await setOrgPlan(org, plan);
          if (!ok) {
            throw new Error(`[billing/webhook] order ${order.id}: org "${org}" not found — plan ${plan} not applied, will retry`);
          }
          console.info(`[billing/webhook] order ${order.id}: set "${org}" to plan ${plan}`);
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
      onOrderRefunded: async (payload) => {
        const order = payload.data;
        const packCredits = creditsForProduct(order.productId);
        if (packCredits <= 0) return; // not a credit pack — nothing was ever granted to reverse
        const org = orderOrg(order);
        if (!org) {
          // No org binding to reconcile against; a redelivery can't fix that, so don't throw — just
          // surface it so a misrouted refund is visible.
          console.warn(`[billing/webhook] refund for order ${order.id}: no org bound; cannot claw back ${packCredits} credits`);
          return;
        }
        const gross = order.netAmount > 0 ? order.netAmount : order.totalAmount;
        const fraction = gross > 0 ? Math.min(1, Math.max(0, order.refundedAmount / gross)) : 1;
        const targetClawback = Math.round(packCredits * fraction);
        const balance = await clawbackOrderRefund(org, order.id, targetClawback, {
          // The cumulative refunded amount distinguishes each refund EVENT for idempotency.
          eventKey: String(order.refundedAmount),
          actor: "polar",
        });
        if (balance === null) {
          console.warn(`[billing/webhook] refund for order ${order.id}: org "${org}" not found`);
          return;
        }
        console.info(`[billing/webhook] refund for order ${order.id}: clawed toward ${targetClawback} (cumulative refund ${order.refundedAmount}); "${org}" balance ${balance}`);
      },
    })
  : async () => NextResponse.json({ error: "Billing webhook is not configured." }, { status: 503 });
