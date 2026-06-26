// GET /api/billing/checkout?org=<slug>&pack=<productId> — start a Polar checkout for a product.
//
// Creates a hosted Polar checkout session (sandbox by default) for the requested product and
// 303-redirects the browser to it. The product must be one we actually sell — a credit pack
// (POLAR_CREDIT_PACKS) or a plan-tier upgrade (POLAR_PLAN_PRODUCTS); an unknown/forged id is rejected,
// so a session is only ever created for a real, priced product. The org is carried into the session two
// ways (externalCustomerId + metadata) so the fulfilment webhook can fulfil the right org; the credits
// granted / tier applied are decided by the webhook from the product, never from anything sent here.
//
// No credits move until Polar confirms payment via the signed webhook (the trust boundary for the
// GRANT is the webhook signature). But CREATING the checkout session itself is an external state change
// (a remote, billable resource), so this safe-looking GET is guarded: a speculative prefetch/prerender
// is refused, and the request must be same-origin (mirroring /api/org/plan). It also returns a UNIFORM
// unknown-org error. Without these, a browser/link prefetcher, crawler, or chat-unfurl bot following the
// link would mint a real Polar session per probe, and the differentiated unknown-org 404 vs existing-org
// 303 would leak which org slugs exist. See docs/BILLING.md.

import { NextResponse } from "next/server";
import { creditsForProduct, getPolar, planForProduct, polarEnabled } from "@/lib/polar";
import { getOrgId, isDbConfigured } from "@/lib/db";
import { isSameOrigin } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** True for a speculative (non-user-initiated) load — browser/link prefetch, prerender, or preview.
 *  Such a fetch must NOT create a Polar checkout session; only an explicit user action should. */
function isPrefetch(request: Request): boolean {
  const h = request.headers;
  if ((h.get("sec-purpose") ?? "").toLowerCase().includes("prefetch")) return true;
  if ((h.get("purpose") ?? "").toLowerCase() === "prefetch") return true;
  if ((h.get("x-moz") ?? "").toLowerCase() === "prefetch") return true;
  if ((h.get("x-purpose") ?? "").toLowerCase() === "preview") return true;
  return false;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const org = (searchParams.get("org") ?? "").trim().toLowerCase();
  const pack = (searchParams.get("pack") ?? "").trim();

  if (!polarEnabled()) {
    return NextResponse.json({ error: "Billing is not configured on this deployment." }, { status: 503 });
  }
  // Never create a session for a speculative load; return a benign no-content so prefetchers/crawlers
  // don't trigger a remote Polar checkout (and don't get a cached redirect that probes org existence).
  if (isPrefetch(request)) return new NextResponse(null, { status: 204 });
  // Same-origin only: a cross-origin/direct probe is refused BEFORE any DB read or Polar call, so it
  // can neither enumerate org slugs (404 vs 303) nor mint sessions. A real in-app link click is
  // same-origin (Sec-Fetch-Site) and passes.
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  }
  if (!org) return NextResponse.json({ error: "Missing org." }, { status: 400 });
  // Accept a product we actually sell — either a credit pack (POLAR_CREDIT_PACKS) or a plan-tier
  // product (POLAR_PLAN_PRODUCTS). An unknown/forged id is rejected, so a session is only ever created
  // for a real, priced product; the webhook decides credits/tier from the product, never from here.
  if (!pack || (creditsForProduct(pack) <= 0 && !planForProduct(pack))) {
    return NextResponse.json({ error: "Unknown product." }, { status: 400 });
  }
  // Fail fast on a target that can never receive the credits — a typo'd/nonexistent slug would create
  // a real paid checkout whose fulfilment then can't bind to an org (pay-into-a-void). Cheap DB read,
  // no auth needed (the grant amount is still webhook-authoritative). Skipped when there's no DB to
  // check against (the org can't exist either, but we can't verify — don't block the documented
  // gift/seed path).
  if (isDbConfigured() && !(await getOrgId(org).catch(() => null))) {
    // Uniform message — don't echo the slug back, so the response can't be used as an existence oracle.
    return NextResponse.json({ error: "Unknown organization. Create it before purchasing credits." }, { status: 404 });
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
