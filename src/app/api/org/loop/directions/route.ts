// APPROVED DIRECTIONS (self-hosted only) — the fenced, budgeted grants approving a plan creates.
//
//   GET ?org=…[&status=active,exhausted][&repo=owner/name]   → { directions }
//
// Gates as the plans ledger: `selfHostGuard`, then `requireOrgAccess`; org-scoped by construction.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";
import { selfHostGuard } from "@/lib/api/self-host";
import { isDirectionStatus, listLoopDirections } from "@/lib/db/loop-directions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = selfHostGuard();
  if (guard) return guard;
  const url = new URL(request.url);
  const org = url.searchParams.get("org")?.trim().toLowerCase() ?? "";
  if (!org || org === PUBLIC_ORG) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  const status = (url.searchParams.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isDirectionStatus);
  const repo = url.searchParams.get("repo")?.trim() || undefined;
  const directions = await listLoopDirections(org, { status, repo }).catch(() => null);
  if (!directions) return NextResponse.json({ error: "Could not read the directions." }, { status: 500 });
  return NextResponse.json({ directions });
}
