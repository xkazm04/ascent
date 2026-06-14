// POST /api/org/simulate { org, dimId, target, repos? }          ->  { projection }   one what-if
// POST /api/org/simulate { org, fixes: [{dimId,target}], repos? } ->  { projection }   multi-dim (SIM-2)
// POST /api/org/simulate { org, rank: true, target?, repos? }     ->  { ranking }      ROI ranking (SIM-3)
// What-if: project the fleet impact of raising one or more dimensions to a target across `repos` (or
// all scanned repos when omitted). The rank mode ranks every dimension by projected gain. Read-only —
// derived from the latest scans, persists nothing.

import { NextResponse } from "next/server";
import { isDbConfigured, rankOrgInvestments, simulateOrgFixes } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import type { DimensionId } from "@/lib/types";
import type { SimFix } from "@/lib/scoring/orgsim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isDimId = (v: string): v is DimensionId => /^D[1-9]$/.test(v);

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "The simulator requires a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    dimId?: string;
    target?: number;
    fixes?: { dimId?: string; target?: number }[];
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

  // Normalize to a list of legs: an explicit `fixes[]` (SIM-2), else the single `{dimId, target}`.
  const rawFixes = Array.isArray(body.fixes) && body.fixes.length > 0 ? body.fixes : [{ dimId: body.dimId, target: body.target }];
  const fixes: SimFix[] = [];
  for (const f of rawFixes) {
    if (typeof f.dimId !== "string" || !isDimId(f.dimId) || typeof f.target !== "number") {
      return NextResponse.json({ error: "Each fix needs { dimId: D1..D9, target: number }." }, { status: 400 });
    }
    fixes.push({ dimId: f.dimId, target: f.target });
  }
  const projection = await simulateOrgFixes(body.org, fixes, repos);
  if (!projection) return NextResponse.json({ error: "No scanned repos to simulate." }, { status: 404 });
  return NextResponse.json({ projection });
}
