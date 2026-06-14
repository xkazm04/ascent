// GET  /api/org/initiatives?org=slug   -> InitiativeRow[]
// POST /api/org/initiatives { org, title, dimId, practiceId?, targetScore?, repos[] } -> { id }
// Tracked, scoped programs of work — usually created from a fleet recommendation.

import { NextResponse } from "next/server";
import { createInitiative, isDbConfigured, listInitiatives } from "@/lib/db";
import { requireOrgAccess, requireOrgRead } from "@/lib/authz";
import type { DimensionId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isDimId = (v: string): v is DimensionId => /^D[1-9]$/.test(v);

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Initiatives require a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const items = await listInitiatives(org);
  return NextResponse.json({ initiatives: items ?? [] });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Initiatives require a database." }, { status: 503 });
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
  };
  if (!body.org || !body.title || !body.dimId || !Array.isArray(body.repos)) {
    return NextResponse.json({ error: "Provide { org, title, dimId, repos[] }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  if (!isDimId(body.dimId)) return NextResponse.json({ error: "dimId must be D1..D9." }, { status: 400 });
  const created = await createInitiative(body.org, {
    title: body.title,
    dimId: body.dimId,
    practiceId: body.practiceId ?? null,
    targetScore: body.targetScore,
    repos: body.repos.filter((r) => typeof r === "string"),
    assigneeLogin: typeof body.assigneeLogin === "string" ? body.assigneeLogin : null,
    targetDate: typeof body.targetDate === "string" ? body.targetDate : null,
    goalId: typeof body.goalId === "string" ? body.goalId : null,
  });
  return NextResponse.json(created ?? { error: "Failed to create initiative." }, { status: created ? 200 : 500 });
}
