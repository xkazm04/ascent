// PATCH  /api/org/goals/:id { status?, target?, label? }
// DELETE /api/org/goals/:id
// Update or remove a maturity goal.

import { NextResponse } from "next/server";
import { deleteGoal, getGoalOrgSlug, isDbConfigured, updateGoal } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DB + per-row tenant gate: the goal must exist and the caller must own its org. Returns the
// blocking response (503/404/401/403), or null when allowed.
async function gate(id: string): Promise<NextResponse | null> {
  if (!isDbConfigured()) return NextResponse.json({ error: "Goals require a database." }, { status: 503 });
  const org = await getGoalOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Goal not found." }, { status: 404 });
  return requireOrgAccess(org);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blocked = await gate(id);
  if (blocked) return blocked;
  const body = (await request.json().catch(() => ({}))) as { status?: string; target?: number; label?: string; targetDate?: string | null };
  if (body.targetDate != null && Number.isNaN(Date.parse(body.targetDate))) {
    return NextResponse.json({ error: "targetDate must be an ISO date (YYYY-MM-DD)." }, { status: 400 });
  }
  try {
    await updateGoal(id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Goal not found." }, { status: 404 });
    return NextResponse.json({ error: "Failed to update goal." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blocked = await gate(id);
  if (blocked) return blocked;
  try {
    await deleteGoal(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Goal not found." }, { status: 404 });
    return NextResponse.json({ error: "Failed to delete goal." }, { status: 500 });
  }
}
