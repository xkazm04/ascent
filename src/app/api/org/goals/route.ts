// GET  /api/org/goals?org=slug          -> GoalProgress[]
// POST /api/org/goals { org, label, metric, target }  -> { id }
// Maturity goals an org steers toward; progress is derived live from the latest scans.

import { NextResponse } from "next/server";
import { createGoal, isGoalMetric, listGoals } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";
import { createdResponse, dbGuard, invalidTargetDate, listOrgRoute } from "@/lib/api/orgPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return listOrgRoute(request, { resourceLabel: "Goals", key: "goals", load: listGoals });
}

export async function POST(request: Request) {
  const guard = dbGuard("Goals");
  if (guard) return guard;
  const body = (await request.json().catch(() => ({}))) as { org?: string; label?: string; metric?: string; target?: number; targetDate?: string | null };
  if (!body.org || !body.label || !body.metric || typeof body.target !== "number") {
    return NextResponse.json({ error: "Provide { org, label, metric, target }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  if (!isGoalMetric(body.metric)) {
    return NextResponse.json({ error: "metric must be overall | adoption | rigor | D1..D9." }, { status: 400 });
  }
  // Maturity metrics are always 0..100; reject out-of-range targets (mirrors the simulate route) so a
  // stray 1000 or -5 can't produce >100% meters, a permanently "Behind" pace, and fantasy ETAs.
  if (!Number.isFinite(body.target) || body.target < 0 || body.target > 100) {
    return NextResponse.json({ error: "target must be a number between 0 and 100." }, { status: 400 });
  }
  const badDate = invalidTargetDate(body.targetDate);
  if (badDate) return badDate;
  const created = await createGoal(body.org, { label: body.label, metric: body.metric, target: body.target, targetDate: body.targetDate ?? null });
  return createdResponse(created, "goal");
}
