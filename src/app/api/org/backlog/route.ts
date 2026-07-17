// GET /api/org/backlog?org=slug[&segment=segmentId][&techGroup=techGroupId] -> { backlog: OrgBacklog | null }
// The org-wide recommendation backlog (owners + due dates), grouped by owner and by due-date
// bucket. Read-only; lets the client panel refresh after a status/assignee/due-date change.
// `segment`/`techGroup` mirror the page's ?segment=/?stack= scope (backlog-management 07-16 #2) so a
// panel refresh stays on the same filtered view instead of snapping back to the whole org.

import { NextResponse } from "next/server";
import { getOrgBacklog, isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "The backlog requires a database." }, { status: 503 });
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const segment = searchParams.get("segment");
  const techGroup = searchParams.get("techGroup");
  const backlog = await getOrgBacklog(org, segment, new Date(), techGroup);
  return NextResponse.json({ backlog });
}
