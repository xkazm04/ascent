// THE PROPOSALS LEDGER (self-hosted only) — every plan a plan-mode lane wrote, minor ones included.
//
//   GET ?org=…[&status=pending,approved][&repo=owner/name][&limit=50]   → { plans }
//
// `status=pending` is the approval inbox. Gates: `selfHostGuard` first (plans exist only where the
// local runner does — on managed cloud this surface is a 404, never an advertised 403), then
// `requireOrgAccess` on the caller's org. The read is org-scoped by construction: `listLoopPlans`
// resolves the org id server-side and ANDs it into the query.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";
import { selfHostGuard } from "@/lib/api/self-host";
import { isPlanStatus, listLoopPlans } from "@/lib/db/loop-plans";

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
    .filter(isPlanStatus);
  const repo = url.searchParams.get("repo")?.trim() || undefined;
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined;
  const plans = await listLoopPlans(org, { status, repo, limit }).catch(() => null);
  if (!plans) return NextResponse.json({ error: "Could not read the plans." }, { status: 500 });
  return NextResponse.json({ plans });
}
