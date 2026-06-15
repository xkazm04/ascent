// POST /api/org/branding { org, brandName?, brandColor?, logoUrl? } -> { ok }   (owner · enterprise)
// Set white-label branding for the executive-briefing PDF (EXEC-5). Owner-gated + same-origin, and
// gated to the enterprise/unlimited entitlement tier. Values are validated/normalized in setOrgBranding
// (hex colour + https logo, else stored null) so a bad input can't break PDF rendering.

import { NextResponse } from "next/server";
import { getCreditState, isDbConfigured, setOrgBranding } from "@/lib/db";
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

  // Entitlement: briefing white-label is an enterprise (unlimited-plan) feature.
  const credit = await getCreditState(body.org).catch(() => null);
  if (!credit?.unlimited) {
    return NextResponse.json({ error: "Briefing branding is an enterprise feature." }, { status: 403 });
  }

  const ok = await setOrgBranding(body.org, {
    brandName: body.brandName ?? null,
    brandColor: body.brandColor ?? null,
    logoUrl: body.logoUrl ?? null,
  });
  if (!ok) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
