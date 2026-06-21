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
import { grantCredits } from "@/lib/db";
import { creditsForProduct } from "@/lib/polar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const secret = process.env.POLAR_WEBHOOK_SECRET;

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
        // Bind the order to an org: the external customer id we set at checkout, falling back to the
        // checkout metadata. Both carry the org slug; either being present is enough.
        const metaOrg = order.metadata && typeof order.metadata.org === "string" ? order.metadata.org : null;
        const org = order.customer?.externalId ?? metaOrg;
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
    })
  : async () => NextResponse.json({ error: "Billing webhook is not configured." }, { status: 503 });
