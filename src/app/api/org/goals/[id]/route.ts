// PATCH  /api/org/goals/:id { status?, target?, label? }
// DELETE /api/org/goals/:id
// Update or remove a maturity goal.

import { NextResponse } from "next/server";
import { deleteGoal, getGoalOrgSlug, isDbConfigured, updateGoal } from "@/lib/db";
import { requireOrgAccess, requireOrgRole } from "@/lib/authz";
import { invalidTargetDate } from "@/lib/api/orgPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DB + per-row tenant gate: the goal must exist and the caller must satisfy `authorize` for its org.
// Returns the blocking response (503/404/401/403), or null when allowed. The authorization strength is
// passed in so a non-destructive PATCH can stay at member-level (requireOrgAccess) while the
// irreversible DELETE demands admin (requireOrgRole(org, "admin")) — see goals-initiatives #2.
async function gate(id: string, authorize: (org: string) => Promise<NextResponse | null>): Promise<NextResponse | null> {
  if (!isDbConfigured()) return NextResponse.json({ error: "Goals require a database." }, { status: 503 });
  const org = await getGoalOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Goal not found." }, { status: 404 });
  return authorize(org);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blocked = await gate(id, requireOrgAccess);
  if (blocked) return blocked;
  // `expected` (optional) carries the values the editor last saw for the fields being changed, so
  // updateGoal can compare-and-set and reject a stale write with 409 instead of silently clobbering a
  // concurrent admin's edit (goals-initiatives #1 — no version column, so this is a value-compare).
  const body = (await request.json().catch(() => ({}))) as {
    status?: string;
    target?: number;
    label?: string;
    targetDate?: string | null;
    expected?: { status?: string; target?: number; label?: string; targetDate?: string | null };
  };
  // Maturity metrics are always 0..100; reject an out-of-range target on update too (matches POST) so a
  // patched goal can't drift into >100% / permanently-"Behind" state.
  if (body.target != null && (!Number.isFinite(body.target) || body.target < 0 || body.target > 100)) {
    return NextResponse.json({ error: "target must be a number between 0 and 100." }, { status: 400 });
  }
  const badDate = invalidTargetDate(body.targetDate);
  if (badDate) return badDate;
  try {
    await updateGoal(id, body, body.expected);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2025") return NextResponse.json({ error: "Goal not found." }, { status: 404 });
    // Optimistic-lock miss: another editor moved a field this patch also writes. 409 so the client can
    // refetch the latest goal and retry, rather than the write being lost.
    if (code === "GOAL_CONFLICT") return NextResponse.json({ error: (err as Error).message }, { status: 409 });
    return NextResponse.json({ error: "Failed to update goal." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // A goal hard-delete drops the goal AND its achievedAt milestone history — irreversible, so require
  // admin (not merely member): a viewer-promoted-to-member must not be able to wipe another admin's
  // goals. Mirrors authz.ts's own "destructive deletes → requireOrgRole(admin)" guidance.
  const blocked = await gate(id, (org) => requireOrgRole(org, "admin"));
  if (blocked) return blocked;
  try {
    await deleteGoal(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Goal not found." }, { status: 404 });
    return NextResponse.json({ error: "Failed to delete goal." }, { status: 500 });
  }
}
