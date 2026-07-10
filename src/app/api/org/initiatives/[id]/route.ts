// PATCH /api/org/initiatives/:id { status?, assigneeLogin?, targetDate?, goalId? }  -> { ok }
// Move an initiative through open | in_progress | done | dismissed, (re)assign an owner, set a due
// date, or link/unlink the steering Goal it serves. Only the provided fields change.

import { NextResponse } from "next/server";
import { getInitiativeOrgSlug, updateInitiative } from "@/lib/db";
import { REC_STATUSES } from "@/lib/types";
import { invalidTargetDate, rowGate } from "@/lib/api/orgPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Initiatives reuse the recommendation status vocabulary — one source of truth (REC_STATUSES).
const STATUSES = new Set<string>(REC_STATUSES);

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blocked = await rowGate({ resourceLabel: "Initiatives", notFound: "Initiative not found.", getOrgSlug: getInitiativeOrgSlug, id });
  if (blocked) return blocked;
  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    assigneeLogin?: string | null;
    targetDate?: string | null;
    goalId?: string | null;
  };
  if (body.status !== undefined && !STATUSES.has(body.status)) {
    return NextResponse.json({ error: `status must be one of: ${[...STATUSES].join(", ")}.` }, { status: 400 });
  }
  const badDate = invalidTargetDate(body.targetDate);
  if (badDate) return badDate;
  const patch: { status?: string; assigneeLogin?: string | null; targetDate?: string | null; goalId?: string | null } = {};
  if (body.status !== undefined) patch.status = body.status;
  if ("assigneeLogin" in body) patch.assigneeLogin = body.assigneeLogin ?? null;
  if ("targetDate" in body) patch.targetDate = body.targetDate ?? null;
  if ("goalId" in body) patch.goalId = body.goalId ?? null;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Provide at least one of { status, assigneeLogin, targetDate, goalId }." }, { status: 400 });
  }
  try {
    await updateInitiative(id, patch);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Initiative not found." }, { status: 404 });
    return NextResponse.json({ error: "Failed to update initiative." }, { status: 500 });
  }
}
