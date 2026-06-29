// PATCH  /api/org/goals/:id { status?, target?, label? }
// DELETE /api/org/goals/:id
// Update or remove a maturity goal.

import { NextResponse } from "next/server";
import { deleteGoal, getGoalOrgSlug, updateGoal } from "@/lib/db";
import { invalidTargetDate, rowGate } from "@/lib/api/orgPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DB + per-row tenant gate: the goal must exist and the caller must own its org. Returns the
// blocking response (503/404/401/403), or null when allowed.
function gate(id: string): Promise<NextResponse | null> {
  return rowGate({ resourceLabel: "Goals", notFound: "Goal not found.", getOrgSlug: getGoalOrgSlug, id });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blocked = await gate(id);
  if (blocked) return blocked;
  const body = (await request.json().catch(() => ({}))) as { status?: string; target?: number; label?: string; targetDate?: string | null };
  const badDate = invalidTargetDate(body.targetDate);
  if (badDate) return badDate;
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
