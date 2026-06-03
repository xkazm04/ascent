// GET /api/recommendations/:id/events -> { events: RecEvent[] }
// The recommendation's activity timeline (status / assignee / due-date changes), newest first.
// Requires DATABASE_URL (Phase 2); returns 503 when persistence is disabled.

import { NextResponse } from "next/server";
import { getRecommendationEvents, isDbConfigured } from "@/lib/db";

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
  try {
    const events = await getRecommendationEvents(id);
    return NextResponse.json({ events: events ?? [] });
  } catch (err) {
    console.error("[recommendations] events query failed", err);
    return NextResponse.json({ error: "Failed to load recommendation history." }, { status: 500 });
  }
}
