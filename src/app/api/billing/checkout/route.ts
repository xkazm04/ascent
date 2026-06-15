// GET /api/billing/checkout?org=<slug>&pack=<productId> — start a Polar checkout for a credit pack.
//
// Creates a hosted Polar checkout session (sandbox by default) for the requested pack and 303-redirects
// the browser to it. The pack must be one we actually sell (POLAR_CREDIT_PACKS) — an unknown/forged
// product id is rejected, so a session is only ever created for a real, priced pack. The org is carried
// into the session two ways (externalCustomerId + metadata) so the fulfilment webhook can credit the
// right org; the GRANT AMOUNT is decided by the webhook from the product, never from anything sent here.
//
// No credits move until Polar confirms payment via the signed webhook, so this GET makes no state
// change and needs no CSRF/owner gate — the trust boundary is the webhook signature. See docs/BILLING.md.

import { NextResponse } from "next/server";
import { creditsForProduct, getPolar, polarEnabled } from "@/lib/polar";
import { publicBaseUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const org = (searchParams.get("org") ?? "").trim().toLowerCase();
  const pack = (searchParams.get("pack") ?? "").trim();

  if (!polarEnabled()) {
    return NextResponse.json({ error: "Billing is not configured on this deployment." }, { status: 503 });
  }
  if (!org) return NextResponse.json({ error: "Missing org." }, { status: 400 });
  if (!pack || creditsForProduct(pack) <= 0) {
    return NextResponse.json({ error: "Unknown credit pack." }, { status: 400 });
  }

  const polar = getPolar();
  if (!polar) {
    return NextResponse.json({ error: "Billing is not configured on this deployment." }, { status: 503 });
  }

  // Absolute base for the post-payment return (publicBaseUrl in prod; the request origin in local dev).
  const base = publicBaseUrl() || origin;
  try {
    const checkout = await polar.checkouts.create({
      products: [pack],
      successUrl: `${base}/org/${encodeURIComponent(org)}?credits=pending`,
      externalCustomerId: org,
      metadata: { org },
    });
    return NextResponse.redirect(checkout.url, 303);
  } catch (err) {
    console.error("[billing/checkout] failed to create Polar checkout", err instanceof Error ? err.message : err);
    return NextResponse.redirect(`${base}/org/${encodeURIComponent(org)}?credits=error`, 303);
  }
}
