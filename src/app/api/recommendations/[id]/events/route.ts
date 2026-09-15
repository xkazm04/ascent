// GET /api/recommendations/:id/events -> { events: RecEvent[], truncated, limit }
// The recommendation's activity timeline (status / assignee / due-date changes), newest first.
// Requires DATABASE_URL (Phase 2); returns 503 when persistence is disabled.
//
// The read is BOUNDED (REC_EVENTS_LIMIT). A bounded list that presents itself as the whole record is
// the quiet lie this repo keeps refusing, so a full page is reported as `truncated: true` with the
// `limit` that produced it — the caller can then say "the 200 most recent changes", which is what it
// has, instead of "the history", which it doesn't.

import { NextResponse } from "next/server";
import { getRecommendationEvents, getRecommendationOrgSlug } from "@/lib/db";
import { REC_EVENTS_LIMIT } from "@/lib/db/scans-recommendations";
import { requireOrgRead } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = dbGuard("Recommendation history", "Recommendation history requires a database (Phase 2 feature).");
  if (guard) return guard;
  const { id } = await ctx.params;
  // Read gate: the timeline (assignee logins, free-text notes, due-date history) is per-tenant data,
  // so resolve the owning org from the id and require read access — closes a cross-tenant read IDOR.
  const org = await getRecommendationOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  try {
    const events = (await getRecommendationEvents(id)) ?? [];
    return NextResponse.json({ events, truncated: events.length >= REC_EVENTS_LIMIT, limit: REC_EVENTS_LIMIT });
  } catch (err) {
    console.error("[recommendations] events query failed", err);
    return NextResponse.json({ error: "Failed to load recommendation history." }, { status: 500 });
  }
}
