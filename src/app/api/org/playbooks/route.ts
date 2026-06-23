// GET  /api/org/playbooks?org=slug                          -> { playbooks: PlaybookRow[] }
// POST /api/org/playbooks { org, title, dimId, summary?, steps? } -> { id }
// Org-authored best-practice playbooks (Direction #3). Read-gated list; member-gated create.

import { NextResponse } from "next/server";
import { createPlaybook, isDbConfigured, listPlaybooks } from "@/lib/db";
import { requireOrgAccess, requireOrgRead } from "@/lib/authz";
import { getSession } from "@/lib/auth";
import { isDimensionId } from "@/lib/maturity/model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Playbooks require a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const playbooks = await listPlaybooks(org);
  return NextResponse.json({ playbooks: playbooks ?? [] });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Playbooks require a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    title?: string;
    dimId?: string;
    summary?: string;
    steps?: string[];
  };
  if (!body.org || !body.title?.trim() || !body.dimId) {
    return NextResponse.json({ error: "Provide { org, title, dimId }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  if (!isDimensionId(body.dimId)) return NextResponse.json({ error: "dimId must be D1..D9." }, { status: 400 });
  const session = await getSession();
  const created = await createPlaybook(
    body.org,
    { title: body.title, dimId: body.dimId, summary: body.summary, steps: Array.isArray(body.steps) ? body.steps : undefined },
    session?.login ?? null,
  );
  return NextResponse.json(created ?? { error: "Failed to create playbook." }, { status: created ? 200 : 500 });
}
