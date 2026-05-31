// GET /api/recommendations?repo=owner/repo
// -> { scanId, items: PersistedRecommendation[] } for the repo's most recent scan.
// Requires DATABASE_URL (Phase 2); returns 503 when persistence is disabled.

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { getLatestRecommendations, isDbConfigured } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";

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
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Recommendation tracking requires a database (Phase 2 feature)." },
      { status: 503 },
    );
  }

  try {
    // Scope to the org the caller may read (own org via session, else public) so a
    // name collision can't leak another tenant's recommendations.
    const orgSlug = await readableOrgForOwner(parsed.owner);
    const result = await getLatestRecommendations(parsed.owner, parsed.repo, { orgSlug });
    return NextResponse.json(result ?? { scanId: null, items: [] });
  } catch (err) {
    console.error("[recommendations] query failed", err);
    return NextResponse.json({ error: "Failed to load recommendations." }, { status: 500 });
  }
}
