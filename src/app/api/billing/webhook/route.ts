// POST /api/billing/webhook — Polar fulfilment. The Webhooks() adapter verifies the signature against
// POLAR_WEBHOOK_SECRET, then on `order.paid` we credit the buyer's org. The grant amount comes from the
// PRODUCT purchased (the server-authoritative pack map), and the grant is IDEMPOTENT on the Polar order
// id, so an at-least-once webhook can retry without ever double-crediting. Subscription renewals also
// arrive as `order.paid`, so a recurring credit-pack product auto-recharges the org each billing cycle.
//
// Fails CLOSED when POLAR_WEBHOOK_SECRET is unset — no secret means no way to verify authenticity, so
// the route 503s instead of trusting an unverified body. See docs/BILLING.md + src/lib/db/credits.ts.

import { NextResponse } from "next/server";
import { Webhooks } from "@polar-sh/nextjs";
import { clawbackOrderRefund, grantCredits } from "@/lib/db";
import { creditsForProduct } from "@/lib/polar";

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
        if (credits <= 0) {
          // A paid order for a product that isn't a known credit pack (e.g. a plain subscription with
          // no credit grant). Not an error — just nothing to fulfil. Logged so a pack-map misconfig is
          // visible rather than silently dropping a real purchase.
          console.warn(
            `[billing/webhook] order ${order.id}: product ${order.productId ?? "?"} is not a credit pack; skipping`,
          );
          return;
        }
        const org = orderOrg(order);
        // A real, paid credit pack that can't be fulfilled YET must be RETRIED, not silently dropped:
        // the @polar-sh adapter responds 200 on a normal return (telling Polar "delivered"), so any
        // `return` here permanently loses the purchase. Throw instead — the adapter surfaces a non-2xx
        // and Polar redelivers under its at-least-once guarantee. The grant is idempotent on
        // `polar:${order.id}`, so a later successful retry can't double-credit. Causes: the order.paid
        // webhook racing ahead of org-row creation, or a transient DB blip resolving the org.
        if (!org) {
          throw new Error(`[billing/webhook] order ${order.id}: no org bound — ${credits} credits unfulfilled, will retry`);
        }
        const balance = await grantCredits(org, credits, {
          reason: "polar",
          actor: "polar",
          externalId: `polar:${order.id}`,
        });
        if (balance === null) {
          throw new Error(`[billing/webhook] order ${order.id}: org "${org}" not found — ${credits} credits unfulfilled, will retry`);
        }
        console.info(`[billing/webhook] order ${order.id}: +${credits} credits to "${org}" (balance ${balance})`);
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
