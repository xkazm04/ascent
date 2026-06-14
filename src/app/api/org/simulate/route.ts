// POST /api/org/simulate { org, dimId, target, repos? }       ->  { projection }   one what-if
// POST /api/org/simulate { org, rank: true, target?, repos? }  ->  { ranking }      ROI ranking (SIM-3)
// What-if: project the fleet impact of raising `dimId` to `target` across `repos` (or all scanned
// repos when omitted). The rank mode ranks every dimension by projected gain. Read-only — derived
// from the latest scans, persists nothing.

import { NextResponse } from "next/server";
import { isDbConfigured, rankOrgInvestments, simulateOrgFix } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import type { DimensionId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isDimId = (v: string): v is DimensionId => /^D[1-9]$/.test(v);

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "The simulator requires a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    dimId?: string;
    target?: number;
    repos?: string[];
    rank?: boolean;
  };
  if (!body.org) return NextResponse.json({ error: "Provide { org }." }, { status: 400 });
  const denied = await requireOrgRead(body.org);
  if (denied) return denied;
  const repos = Array.isArray(body.repos) ? body.repos.filter((r) => typeof r === "string") : [];

  // Rank mode (SIM-3): "where should we invest?" — rank every dimension by projected fleet gain.
  if (body.rank) {
    const target = typeof body.target === "number" ? body.target : 70;
    const ranking = await rankOrgInvestments(body.org, target, repos);
    if (!ranking) return NextResponse.json({ error: "No scanned repos to rank." }, { status: 404 });
    return NextResponse.json({ ranking });
  }

  if (!body.dimId || typeof body.target !== "number") {
    return NextResponse.json({ error: "Provide { org, dimId, target }." }, { status: 400 });
  }
  if (!isDimId(body.dimId)) return NextResponse.json({ error: "dimId must be D1..D9." }, { status: 400 });
  const projection = await simulateOrgFix(body.org, body.dimId, body.target, repos);
  if (!projection) return NextResponse.json({ error: "No scanned repos to simulate." }, { status: 404 });
  return NextResponse.json({ projection });
}
