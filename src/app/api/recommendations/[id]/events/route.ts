// GET /api/recommendations/:id/events -> { events: RecEvent[] }
// The recommendation's activity timeline (status / assignee / due-date changes), newest first.
// Requires DATABASE_URL (Phase 2); returns 503 when persistence is disabled.

import { NextResponse } from "next/server";
import { getRecommendationEvents, getRecommendationOrgSlug, isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Recommendation history requires a database (Phase 2 feature)." },
      { status: 503 },
    );
  }
  const { id } = await ctx.params;
  // Read gate: the timeline (assignee logins, free-text notes, due-date history) is per-tenant data,
  // so resolve the owning org from the id and require read access — closes a cross-tenant read IDOR.
  const org = await getRecommendationOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  try {
    const events = await getRecommendationEvents(id);
    return NextResponse.json({ events: events ?? [] });
  } catch (err) {
    console.error("[recommendations] events query failed", err);
    return NextResponse.json({ error: "Failed to load recommendation history." }, { status: 500 });
  }
}
