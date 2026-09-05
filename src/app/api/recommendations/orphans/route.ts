// GET /api/recommendations/orphans?repo=owner/repo
// -> { items: OrphanedTrackedRec[] }
//
// The tracking the last re-scan could not carry forward. `matchRecommendations` refuses to guess when
// two gaps in one dimension were both reworded — correct, but scans-persist then wrote the new rows
// at open/unassigned and the user's status/assignee/target-date vanished with no error at all. This
// route is the visibility: it names what was dropped so the UI can offer a re-link.
//
// Derived from the two most recent scans (see getOrphanedTrackedRecommendations) — no stored list to
// go stale. Mirrors the sibling GET's org resolution exactly, so a private repo's assignee logins and
// target dates are never served out of the shared public org.

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { getOrphanedTrackedRecommendations } from "@/lib/db";
import { PUBLIC_ORG } from "@/lib/auth";
import { canReadOrg } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const repo = searchParams.get("repo");
  if (!repo) {
    return NextResponse.json({ error: "Missing 'repo' query parameter." }, { status: 400 });
  }
  const parsed = parseRepoUrl(repo);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid repository reference." }, { status: 400 });
  }
  const guard = dbGuard("Recommendation tracking", "Recommendation tracking requires a database (Phase 2 feature).");
  if (guard) return guard;

  try {
    const ownerOrg = parsed.owner.toLowerCase();
    const orgSlug = (await canReadOrg(ownerOrg)) ? ownerOrg : PUBLIC_ORG;
    const items = await getOrphanedTrackedRecommendations(parsed.owner, parsed.repo, { orgSlug });
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[recommendations] orphan query failed", err);
    return NextResponse.json({ error: "Failed to load orphaned tracking." }, { status: 500 });
  }
}
