// POST /api/org/branding { org, brandName?, brandColor?, logoUrl? } -> { ok }   (owner · Team+)
// Set white-label branding for the executive-briefing PDF (EXEC-5). Owner-gated + same-origin, and
// gated to the Team-and-up entitlement tier. Values are validated/normalized in setOrgBranding
// (hex colour + https logo, else stored null) so a bad input can't break PDF rendering.

import { NextResponse } from "next/server";
import { getCreditState, isDbConfigured, setOrgBranding } from "@/lib/db";
import { planAllowsWhiteLabel } from "@/lib/plans";
import { requireOrgRole } from "@/lib/authz";
import { isSameOrigin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Branding requires a database." }, { status: 503 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; brandName?: string; brandColor?: string; logoUrl?: string };
  if (!body.org) return NextResponse.json({ error: "Provide { org }." }, { status: 400 });
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;

  // Entitlement: briefing white-label is a Team-and-up feature (so a reseller on Team can brand the
  // reports they hand to clients), not Enterprise-only. Distinguish "couldn't determine the plan"
  // (a transient DB hiccup) from "genuinely not entitled": folding a read error into `null` mapped a
  // legitimate Team/Enterprise owner to a misleading 403 "you don't have this plan" during an outage,
  // so a read failure returns a retryable 503 instead.
  let credit;
  try {
    credit = await getCreditState(body.org);
  } catch {
    return NextResponse.json({ error: "Couldn’t verify your plan right now — please try again." }, { status: 503 });
  }
  if (!planAllowsWhiteLabel(credit?.plan)) {
    return NextResponse.json({ error: "Briefing branding is a Team-plan feature." }, { status: 403 });
  }

  // Echo the NORMALIZED values actually stored so the client can warn about anything the validator
  // discarded (a non-https/private logo → null) or truncated (an >80-char name) instead of showing
  // unconditional success while the value was silently dropped.
  const stored = await setOrgBranding(body.org, {
    brandName: body.brandName ?? null,
    brandColor: body.brandColor ?? null,
    logoUrl: body.logoUrl ?? null,
  });
  if (!stored) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  // setOrgBranding returns { branding, rejected }; unwrap so the client gets the FLAT normalized
  // OrgBranding it reads (d.branding.brandName/…) plus the list of dropped fields to warn about —
  // passing `stored` whole would nest it under branding and blank every field client-side.
  return NextResponse.json({ ok: true, branding: stored.branding, rejected: stored.rejected });
}
