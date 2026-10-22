// GET /api/billing/checkout/status?org=<slug>&checkout_id=<id> - what happened to THIS purchase.
//
// READ-ONLY. The checkout route stamps Polar's {CHECKOUT_ID} into the success URL; the return banner
// polls this route with that id and renders one state from checkoutReturnModel (confirming, paid,
// landed, stalled, failed, expired). Nothing here creates, grants or charges anything.
//
// Guards mirror checkout / portal: Polar off -> 503, speculative prefetch -> 204, same-origin only, the
// shared public org refused, owner-gated before any Polar read. Then GATE-THEN-CONSTRAIN: the gated org
// must be the org the checkout was minted for (externalCustomerId, else metadata.org, the same binding
// the webhook fulfils against), or the answer is a uniform 404 "Unknown checkout." - identical to a
// checkout id Polar does not know, so an owner cannot read, or probe for, another org's purchase.
//
// "landed" is claimed only from a grant record that exists: the CreditLedger row the webhook writes
// (`polar:<orderId>`, looked up under THIS org) for a credit pack, and for a plan product the org's
// current plan plus a live Subscription row for the order's subscription. See
// docs/features/billing/billing.md.

import { NextResponse } from "next/server";
import { creditsForProduct, getPolar, planForProduct, polarEnabled } from "@/lib/polar";
import { getCreditState, getPrisma, isDbConfigured } from "@/lib/db";
import { getOrgSubscription } from "@/lib/billing/subscriptionRecord";
import { deriveCheckoutReturn, type LandedGrant } from "@/lib/billing/checkoutReturnModel";
import { requireSameOrigin } from "@/lib/auth";
import { refusePublicOrgAdmin, requireOrgRole } from "@/lib/authz";
import { normalizeOrgSlug } from "@/lib/db/org-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };
/** Polar ids are UUIDs; anything else (including an unsubstituted `{CHECKOUT_ID}`) is not a checkout. */
const CHECKOUT_ID = /^[A-Za-z0-9_-]{1,128}$/;

function isPrefetch(request: Request): boolean {
  const h = request.headers;
  if ((h.get("sec-purpose") ?? "").toLowerCase().includes("prefetch")) return true;
  if ((h.get("purpose") ?? "").toLowerCase() === "prefetch") return true;
  if ((h.get("x-moz") ?? "").toLowerCase() === "prefetch") return true;
  if ((h.get("x-purpose") ?? "").toLowerCase() === "preview") return true;
  return false;
}

const unknownCheckout = () => NextResponse.json({ error: "Unknown checkout." }, { status: 404, headers: NO_STORE });
const unavailable = () =>
  NextResponse.json({ error: "Couldn't check this purchase right now." }, { status: 503, headers: NO_STORE });

function boundOrg(c: { externalCustomerId?: string | null; metadata?: Record<string, unknown> | null }): string {
  const meta = c.metadata && typeof c.metadata.org === "string" ? c.metadata.org : "";
  return normalizeOrgSlug(c.externalCustomerId ?? meta);
}

interface OrderFacts {
  id: string;
  productId: string | null;
  subscriptionId?: string | null;
}

/** The grant record for this order under THIS org, or false when it has not been written (yet). Every
 *  grant the product confers must exist: a pack AND a tier product lands only when both did. */
async function readGrant(org: string, order: OrderFacts): Promise<false | LandedGrant> {
  if (!isDbConfigured()) return false;
  const packCredits = creditsForProduct(order.productId);
  const plan = planForProduct(order.productId);
  if (packCredits <= 0 && !plan) return false;
  const grant: LandedGrant = {};
  if (packCredits > 0) {
    const row = await getPrisma().creditLedger.findFirst({
      where: { externalId: `polar:${order.id}`, org: { slug: org } },
      select: { delta: true },
    });
    if (!row) return false;
    grant.credits = row.delta;
  }
  const state = await getCreditState(org);
  if (plan) {
    if (state.plan !== plan) return false;
    const sub = await getOrgSubscription(org);
    if (!sub || sub.status !== "active") return false;
    if (order.subscriptionId && sub.stripeId !== order.subscriptionId) return false;
    grant.plan = plan;
  }
  if (packCredits > 0) grant.balance = state.balance;
  return grant;
}

const statusCodeOf = (err: unknown) =>
  typeof (err as { statusCode?: unknown })?.statusCode === "number" ? (err as { statusCode: number }).statusCode : 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const org = normalizeOrgSlug(searchParams.get("org") ?? "");
  const checkoutId = (searchParams.get("checkout_id") ?? "").trim();

  if (!polarEnabled()) {
    return NextResponse.json({ error: "Billing is not configured on this deployment." }, { status: 503 });
  }
  if (isPrefetch(request)) return new NextResponse(null, { status: 204 });
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!org) return NextResponse.json({ error: "Missing org." }, { status: 400 });
  if (!CHECKOUT_ID.test(checkoutId)) return NextResponse.json({ error: "Missing checkout." }, { status: 400 });
  const denied = refusePublicOrgAdmin(org) ?? (await requireOrgRole(org, "owner"));
  if (denied) return denied;

  const polar = getPolar();
  if (!polar) return NextResponse.json({ error: "Billing is not configured on this deployment." }, { status: 503 });

  try {
    let checkout: Awaited<ReturnType<typeof polar.checkouts.get>>;
    try {
      checkout = await polar.checkouts.get({ id: checkoutId });
    } catch (err) {
      const code = statusCodeOf(err);
      // Not found and malformed both read as the same 404 as a foreign checkout: no oracle.
      if (code === 404 || code === 422) return unknownCheckout();
      throw err;
    }
    if (boundOrg(checkout) !== org) return unknownCheckout();

    if (checkout.status !== "succeeded") {
      return NextResponse.json(deriveCheckoutReturn({ checkoutStatus: checkout.status }), { headers: NO_STORE });
    }
    const page = await polar.orders.list({ checkoutId: checkout.id, limit: 1 });
    const order = page.result.items[0];
    const paidAt = order?.createdAt ?? checkout.modifiedAt ?? checkout.createdAt;
    const elapsedMs = paidAt ? Date.now() - new Date(paidAt).getTime() : 0;
    const landed = order ? await readGrant(org, order) : false;
    const view = deriveCheckoutReturn({ checkoutStatus: "succeeded", landed, elapsedMs, orderId: order?.id ?? null });
    return NextResponse.json(view, { headers: NO_STORE });
  } catch (err) {
    console.error("[billing/checkout/status] failed to read checkout", err instanceof Error ? err.message : err);
    return unavailable();
  }
}
