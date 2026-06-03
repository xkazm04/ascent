// GET /api/org/backlog?org=slug[&segment=segmentId] -> { backlog: OrgBacklog | null }
// The org-wide recommendation backlog (owners + due dates), grouped by owner and by due-date
// bucket. Read-only; lets the client panel refresh after a status/assignee/due-date change.

import { NextResponse } from "next/server";
import { getOrgBacklog, isDbConfigured } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "The backlog requires a database." }, { status: 503 });
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const segment = searchParams.get("segment");
  const backlog = await getOrgBacklog(org, segment);
  return NextResponse.json({ backlog });
}
