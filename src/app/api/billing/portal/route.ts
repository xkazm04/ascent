// GET /api/billing/portal?org=<slug> — Polar customer portal for this org.
//
// Owner-gated one-click into Polar's hosted portal (cancel, payment method, invoices). Mirrors
// checkout: prefetch is a 204 no-op, same-origin only, owner before any Polar call, uniform unknown-org
// 404. polarCustomerPortalUrl mints a customer session keyed by the same externalCustomerId checkout
// stamps, and falls back to Polar's documented hosted page when the SDK has no session API. Polar off
// (free / self-host) → 503; the UI omits the control in that case. See docs/features/billing/billing.md.

import { NextResponse } from "next/server";
import { polarCustomerPortalUrl, polarEnabled } from "@/lib/polar";
import { getOrgId, isDbConfigured, isDbUnavailableError } from "@/lib/db";
import { requireSameOrigin } from "@/lib/auth";
import { requireOrgRole } from "@/lib/authz";
import { publicBaseUrl } from "@/lib/site";
import { normalizeOrgSlug } from "@/lib/db/org-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** True for a speculative (non-user-initiated) load — browser/link prefetch, prerender, or preview.
 *  Such a fetch must NOT mint a Polar customer session. */
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
  const org = normalizeOrgSlug(searchParams.get("org") ?? "");

  if (!polarEnabled()) {
    return NextResponse.json({ error: "Billing is not configured on this deployment." }, { status: 503 });
  }
  if (isPrefetch(request)) return new NextResponse(null, { status: 204 });
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  if (!org) return NextResponse.json({ error: "Missing org." }, { status: 400 });
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;
  if (isDbConfigured()) {
    let orgId: string | null;
    try {
      orgId = await getOrgId(org);
    } catch (err) {
      if (isDbUnavailableError(err)) {
        console.error("[billing/portal] org lookup failed (db unavailable)", err instanceof Error ? err.message : err);
        return NextResponse.json({ error: "Couldn't verify the organization right now. Please try again." }, { status: 503 });
      }
      throw err;
    }
    if (!orgId) {
      return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
    }
  }

  const base = publicBaseUrl() || origin;
  try {
    const url = await polarCustomerPortalUrl(org, { returnUrl: `${base}/org/${encodeURIComponent(org)}` });
    if (!url) {
      return NextResponse.json({ error: "Couldn't open the billing portal right now. Please try again." }, { status: 503 });
    }
    return NextResponse.redirect(url, 303);
  } catch (err) {
    console.error("[billing/portal] failed to open Polar customer portal", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Couldn't open the billing portal right now. Please try again." }, { status: 503 });
  }
}
