// POST /api/org/branding { org, brandName?, brandColor?, logoUrl? } -> { ok }   (owner · Team+)
// Set white-label branding for the executive-briefing PDF (EXEC-5). Owner-gated + same-origin, and
// gated to the Team-and-up entitlement tier. Values are validated/normalized in setOrgBranding
// (hex colour + https logo, else stored null) so a bad input can't break PDF rendering.

import { NextResponse } from "next/server";
import { getCreditState, isDbConfigured, setOrgBranding } from "@/lib/db";
import { planAllowsWhiteLabel } from "@/lib/plans";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Branding requires a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<{ brandName?: string; brandColor?: string; logoUrl?: string }>(request);
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;

  // Entitlement: briefing white-label is a Team-and-up feature (so a reseller on Team can brand the
  // reports they hand to clients), not Enterprise-only.
  const credit = await getCreditState(org).catch(() => null);
  if (!planAllowsWhiteLabel(credit?.plan)) {
    return NextResponse.json({ error: "Briefing branding is a Team-plan feature." }, { status: 403 });
  }

  const ok = await setOrgBranding(org, {
    brandName: body.brandName ?? null,
    brandColor: body.brandColor ?? null,
    logoUrl: body.logoUrl ?? null,
  });
  if (!ok) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
