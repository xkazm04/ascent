// GET  /api/org/playbooks?org=slug                          -> { playbooks: PlaybookRow[] }
// POST /api/org/playbooks { org, title, dimId, summary?, steps? } -> { id }
//      optional fromDim=D1..D9 | fromRec=true seeds title/summary/steps from PLAYBOOK_TEMPLATES
//      (fromRec = the briefing's ranked next move). Steps are never invented (G4).
// Org-authored best-practice playbooks (Direction #3). Read-gated list; member-gated create.

import { NextResponse } from "next/server";
import { createPlaybook, getOrgRecommendations, isDbConfigured, listPlaybooks } from "@/lib/db";
import { requireOrgAccess, requireOrgRead } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { isDimensionId } from "@/lib/maturity/model";
import { seedPlaybookCreate, type PlaybookCreateBody } from "@/lib/org/playbook-templates";

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
  const body = (await request.json().catch(() => ({}))) as PlaybookCreateBody & { org?: string };
  const fromRec = body.fromRec === true;
  const fromDim = typeof body.fromDim === "string" && body.fromDim ? body.fromDim : undefined;
  if (!body.org || (!fromRec && !fromDim && (!body.title?.trim() || !body.dimId))) {
    return NextResponse.json({ error: "Provide { org, title, dimId }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;

  // Rank 1 of getOrgRecommendations is briefingNextMove — same source the exec page / PDF / markdown
  // print. Fetched after the gate so an unauthorized caller cannot probe the fleet's next move.
  const rec = fromRec
    ? ((await getOrgRecommendations(body.org, 1).catch(() => null))?.[0] ?? null)
    : null;
  const seeded = seedPlaybookCreate({ ...body, fromDim, fromRec }, rec);
  if (!seeded.ok) return NextResponse.json({ error: seeded.error }, { status: 400 });
  if (!isDimensionId(seeded.input.dimId)) {
    return NextResponse.json({ error: "dimId must be D1..D9." }, { status: 400 });
  }

  // resolveViewerLogin: the dormant custom-OAuth session is null under the ACTIVE Supabase wall,
  // so this actor was recorded as null in production.
  const actorLogin = await resolveViewerLogin();
  const created = await createPlaybook(body.org, seeded.input, actorLogin);
  return NextResponse.json(created ?? { error: "Failed to create playbook." }, { status: created ? 200 : 500 });
}

