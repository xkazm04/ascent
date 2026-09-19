// POST /api/org/segments/:id/repos/bulk { org, fullNames[], member? }
// Bulk tag (member=true, the default) or untag MANY repos into a segment in one round-trip — the
// backend for auto-segments (by language) and the leaderboard's bulk action bar. Org-scoped
// server-side so a caller can only touch their own tenant's segments/repos.

import { NextResponse } from "next/server";
import { recordOrgAudit, setRepoSegmentsBulk } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { dbGuard } from "@/lib/api/orgPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 1000; // bound the batch so an unbounded list can't be sent to the DB

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = dbGuard("Segments");
  if (guard) return guard;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { org?: string; fullNames?: string[]; member?: boolean };
  if (!body.org || !Array.isArray(body.fullNames)) {
    return NextResponse.json({ error: "Provide { org, fullNames[] }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  const fullNames = body.fullNames.filter((f) => typeof f === "string").slice(0, MAX_BATCH);
  const member = body.member !== false; // default to tagging
  const changed = await setRepoSegmentsBulk(body.org, id, fullNames, member);
  if (changed < 0) return NextResponse.json({ error: "Unknown segment for this org." }, { status: 404 });
  // Counts only — a bulk body can name 1000 repos, so the trail never stores the list.
  const actorLogin = await resolveViewerLogin();
  await recordOrgAudit(
    "segment.bulk_tag",
    body.org,
    { segmentId: id, member, requested: fullNames.length, changed },
    actorLogin ?? undefined,
  );
  return NextResponse.json({ ok: true, changed, member });
}
