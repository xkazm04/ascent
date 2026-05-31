// PATCH /api/recommendations/:id  { status }  -> updated PersistedRecommendation
// Updates the tracked status of a recommendation (open | in_progress | done | dismissed).

import { NextResponse } from "next/server";
import { REC_STATUSES, type RecStatus } from "@/lib/types";
import { isDbConfigured, updateRecommendationStatus } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Recommendation tracking requires a database (Phase 2 feature)." },
      { status: 503 },
    );
  }

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { status?: string };
  const status = body.status;
  if (!status || !REC_STATUSES.includes(status as RecStatus)) {
    return NextResponse.json(
      { error: `Invalid status. Expected one of: ${REC_STATUSES.join(", ")}.` },
      { status: 400 },
    );
  }

  try {
    const updated = await updateRecommendationStatus(id, status as RecStatus);
    return NextResponse.json(updated);
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: "Recommendation not found." }, { status: 404 });
    }
    console.error("[recommendations] update failed", err);
    return NextResponse.json({ error: "Failed to update recommendation." }, { status: 500 });
  }
}
