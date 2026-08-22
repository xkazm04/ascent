// GET /api/org/loop/<id>?org=… — one loop run in full: the run row, every lane, and each lane's
// before/after scan pair with the diff between them (getLoopRunDetail).
//
// `org` is REQUIRED even though the id alone would resolve the run. Authorization runs against a
// slug the caller claims, and the run's own orgId is then checked against it — an id-only route
// would authorize nothing at all, or would have to trust the row it is about to disclose.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";
import { selfHostGuard } from "@/lib/api/self-host";
import { getLoopRunDetail } from "@/lib/db/loop-runs";
import { orgIdForSlug } from "@/lib/db/loop-tenancy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = selfHostGuard();
  if (guard) return guard;
  const { id } = await ctx.params;
  const org = new URL(request.url).searchParams.get("org")?.trim().toLowerCase() ?? "";
  if (!org || org === PUBLIC_ORG) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;

  const detail = await getLoopRunDetail(id);
  if (!detail || detail.run.orgId !== (await orgIdForSlug(org))) {
    return NextResponse.json({ error: "No such loop run." }, { status: 404 });
  }
  return NextResponse.json(detail);
}
