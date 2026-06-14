// PATCH /api/org/initiatives/:id { status?, assigneeLogin?, targetDate?, goalId? }  -> { ok }
// Move an initiative through open | in_progress | done | dismissed, (re)assign an owner, set a due
// date, or link/unlink the steering Goal it serves. Only the provided fields change.

import { NextResponse } from "next/server";
import { getInitiativeOrgSlug, isDbConfigured, updateInitiative } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["open", "in_progress", "done", "dismissed"]);

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Initiatives require a database." }, { status: 503 });
  const { id } = await ctx.params;
  const org = await getInitiativeOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Initiative not found." }, { status: 404 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    assigneeLogin?: string | null;
    targetDate?: string | null;
    goalId?: string | null;
  };
  if (body.status !== undefined && !STATUSES.has(body.status)) {
    return NextResponse.json({ error: `status must be one of: ${[...STATUSES].join(", ")}.` }, { status: 400 });
  }
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
