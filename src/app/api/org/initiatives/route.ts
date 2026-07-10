// GET  /api/org/initiatives?org=slug   -> InitiativeRow[]
// POST /api/org/initiatives { org, title, dimId, practiceId?, targetScore?, repos[] } -> { id }
// Tracked, scoped programs of work — usually created from a fleet recommendation.

import { NextResponse } from "next/server";
import { createInitiative, listInitiatives } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";
import { isDimensionId } from "@/lib/maturity/model";
import { createdResponse, dbGuard, invalidTargetDate, listOrgRoute } from "@/lib/api/orgPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return listOrgRoute(request, { resourceLabel: "Initiatives", key: "initiatives", load: listInitiatives });
}

export async function POST(request: Request) {
  const guard = dbGuard("Initiatives");
  if (guard) return guard;
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    title?: string;
    dimId?: string;
    practiceId?: string;
    targetScore?: number;
    repos?: string[];
    assigneeLogin?: string;
    targetDate?: string | null;
    goalId?: string | null;
    playbookId?: string | null;
  };
  if (!body.org || !body.title || !body.dimId || !Array.isArray(body.repos)) {
    return NextResponse.json({ error: "Provide { org, title, dimId, repos[] }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  if (!isDimensionId(body.dimId)) return NextResponse.json({ error: "dimId must be D1..D9." }, { status: 400 });
  const badDate = invalidTargetDate(body.targetDate);
  if (badDate) return badDate;
  const created = await createInitiative(body.org, {
    title: body.title,
    dimId: body.dimId,
    practiceId: body.practiceId ?? null,
    targetScore: body.targetScore,
    repos: body.repos.filter((r) => typeof r === "string"),
    assigneeLogin: typeof body.assigneeLogin === "string" ? body.assigneeLogin : null,
    targetDate: typeof body.targetDate === "string" ? body.targetDate : null,
    goalId: typeof body.goalId === "string" ? body.goalId : null,
    playbookId: typeof body.playbookId === "string" ? body.playbookId : null,
  });
  return createdResponse(created, "initiative");
}
