// GET  /api/org/goals?org=slug          -> GoalProgress[]
// POST /api/org/goals { org, label, metric, target }  -> { id }
// Maturity goals an org steers toward; progress is derived live from the latest scans.

import { NextResponse } from "next/server";
import { createGoal, isDbConfigured, isGoalMetric, listGoals } from "@/lib/db";
import { requireOrgAccess, requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Goals require a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const goals = await listGoals(org);
  return NextResponse.json({ goals: goals ?? [] });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Goals require a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; label?: string; metric?: string; target?: number; targetDate?: string | null };
  if (!body.org || !body.label || !body.metric || typeof body.target !== "number") {
    return NextResponse.json({ error: "Provide { org, label, metric, target }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  if (!isGoalMetric(body.metric)) {
    return NextResponse.json({ error: "metric must be overall | adoption | rigor | D1..D9." }, { status: 400 });
  }
  if (body.targetDate != null && Number.isNaN(Date.parse(body.targetDate))) {
    return NextResponse.json({ error: "targetDate must be an ISO date (YYYY-MM-DD)." }, { status: 400 });
  }
  const created = await createGoal(body.org, { label: body.label, metric: body.metric, target: body.target, targetDate: body.targetDate ?? null });
  return NextResponse.json(created ?? { error: "Failed to create goal." }, { status: created ? 200 : 500 });
}
