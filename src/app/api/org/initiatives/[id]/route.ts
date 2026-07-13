// PATCH /api/org/initiatives/:id { status?, assigneeLogin?, targetDate?, goalId? }  -> { ok }
// Move an initiative through open | in_progress | done | dismissed, (re)assign an owner, set a due
// date, or link/unlink the steering Goal it serves. Only the provided fields change.

import { NextResponse } from "next/server";
import { getGoalOrgSlug, getInitiativeOrgSlug, updateInitiative } from "@/lib/db";
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
  // `expected` (optional): the editor's last-seen values for the fields being changed, so
  // updateInitiative can compare-and-set and 409 a stale write instead of clobbering a concurrent
  // admin's edit (goals-initiatives #1 — Initiative has no version column, so this is a value-compare).
  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    assigneeLogin?: string | null;
    targetDate?: string | null;
    goalId?: string | null;
    expected?: { status?: string; assigneeLogin?: string | null; targetDate?: string | null; goalId?: string | null };
  };
  if (body.status !== undefined && !STATUSES.has(body.status)) {
    return NextResponse.json({ error: `status must be one of: ${[...STATUSES].join(", ")}.` }, { status: 400 });
  }
  const badDate = invalidTargetDate(body.targetDate);
  if (badDate) return badDate;
  // Tenant-scope the goal link (goals-initiatives #7): a non-null goalId must reference a Goal in the
  // SAME org as this initiative, or the patch would store a cross-org foreign key (which silently
  // resolves to an unlinked label on read, masking the leak). The row's TRUE org comes from
  // getInitiativeOrgSlug (never a body value) — the same source rowGate already gated on above.
  if (typeof body.goalId === "string" && body.goalId) {
    const [initOrg, goalOrg] = await Promise.all([getInitiativeOrgSlug(id), getGoalOrgSlug(body.goalId)]);
    if (!initOrg || !goalOrg || goalOrg.toLowerCase() !== initOrg.toLowerCase()) {
      return NextResponse.json({ error: "goalId must reference a goal in this org." }, { status: 400 });
    }
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
    await updateInitiative(id, patch, body.expected);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2025") return NextResponse.json({ error: "Initiative not found." }, { status: 404 });
    // Optimistic-lock miss: a concurrent editor moved a field this patch also writes. 409 → refetch+retry.
    if (code === "INIT_CONFLICT") return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    return NextResponse.json({ error: "Failed to update initiative." }, { status: 500 });
  }
}
