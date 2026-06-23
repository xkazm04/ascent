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
import { getOrgId, isDbConfigured } from "@/lib/db";
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
  // Fail fast on a target that can never receive the credits — a typo'd/nonexistent slug would create
  // a real paid checkout whose fulfilment then can't bind to an org (pay-into-a-void). Cheap DB read,
  // no auth needed (the grant amount is still webhook-authoritative). Skipped when there's no DB to
  // check against (the org can't exist either, but we can't verify — don't block the documented
  // gift/seed path).
  if (isDbConfigured() && !(await getOrgId(org).catch(() => null))) {
    return NextResponse.json({ error: `Unknown organization "${org}". Create it before purchasing credits.` }, { status: 404 });
  }

  const polar = getPolar();
  if (!polar) {
    return NextResponse.json({ error: "Billing is not configured on this deployment." }, { status: 503 });
  }

  // Absolute base for the post-payment return (publicBaseUrl in prod; the request origin in local dev).
  const base = publicBaseUrl() || origin;
  // Single source for the org return URL so the success and error redirects can't drift on path/encoding.
  const orgUrl = (status: string) => `${base}/org/${encodeURIComponent(org)}?credits=${status}`;
  try {
    const checkout = await polar.checkouts.create({
      products: [pack],
      successUrl: orgUrl("pending"),
      externalCustomerId: org,
      metadata: { org },
    });
    return NextResponse.redirect(checkout.url, 303);
  } catch (err) {
    console.error("[billing/checkout] failed to create Polar checkout", err instanceof Error ? err.message : err);
    return NextResponse.redirect(orgUrl("error"), 303);
  }
}
