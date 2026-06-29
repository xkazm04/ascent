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
import { grantCredits, sumRefundClawback } from "@/lib/db";
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
        // PERMANENT failure: the order carries no org binding at all (neither customer.externalId nor
        // metadata.org). A redelivery has the identical payload, so throwing would only spin Polar's
        // at-least-once retries forever against a result that can never change. Log loudly (the
        // dead-letter signal for an unfulfillable-but-paid order) and ACK so the retry storm stops.
        // Contrast `balance === null` below, which IS retried (the org row may simply not exist YET).
        if (!org) {
          console.error(`[billing/webhook] order ${order.id}: no org bound — ${credits} credits UNFULFILLED (paid, not retried; needs manual reconciliation)`);
          return;
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
      // a full refund reverses the whole pack; a partial refund reverses its share. Handles MULTIPLE
      // separate partial refunds on one order (Polar's `refundedAmount` is cumulative): we compute the
      // TARGET total clawback at this refund level and reverse only the INCREMENTAL share not already
      // clawed, keyed per cumulative amount so a redelivery is idempotent. (The old code keyed
      // idempotency on the order id alone, so every refund after the first was silently dropped.)
      // grantCredits clamps at zero, so an already-spent balance simply absorbs what remains.
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
        // Use the SAME money basis for numerator and denominator: `refundedAmount` is measured against the
        // amount CHARGED (`totalAmount`, incl. tax/fees), so divide by `totalAmount` — not `netAmount`
        // (net-of-fees), which over/under-clawed on every taxed partial refund.
        const basis = order.totalAmount > 0 ? order.totalAmount : order.netAmount;
        const fraction = basis > 0 ? Math.min(1, Math.max(0, order.refundedAmount / basis)) : 1;
        const target = Math.round(packCredits * fraction); // total credits to have clawed at this cumulative level
        const already = await sumRefundClawback(org, order.id); // credits already reversed for this order
        const delta = target - already; // only the incremental share for THIS refund
        if (delta <= 0) return; // nothing new to reverse (or an idempotent redelivery of the same level)
        const balance = await grantCredits(org, -delta, {
          reason: "polar-refund",
          actor: "polar",
          // Per cumulative refund amount: a redelivery of the same level no-ops; a further partial refund
          // (larger cumulative `refundedAmount`) gets its own key and reverses only its incremental delta.
          externalId: `polar-refund:${order.id}:${order.refundedAmount}`,
        });
        if (balance === null) {
          console.warn(`[billing/webhook] refund for order ${order.id}: org "${org}" not found`);
          return;
        }
        console.info(`[billing/webhook] refund for order ${order.id}: -${delta} credits from "${org}" (target ${target}, prior ${already}, balance ${balance})`);
      },
    })
  : async () => NextResponse.json({ error: "Billing webhook is not configured." }, { status: 503 });
