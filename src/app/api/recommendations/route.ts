// GET /api/recommendations?repo=owner/repo
// -> { scanId, items: PersistedRecommendation[] } for the repo's most recent scan.
// Requires DATABASE_URL (Phase 2); returns 503 when persistence is disabled.

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { getLatestRecommendations, isDbConfigured } from "@/lib/db";
import { PUBLIC_ORG } from "@/lib/auth";
import { canReadOrg } from "@/lib/authz";

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
    // Scope to the org the caller may read, using the SAME Supabase-aware membership resolver the
    // sibling per-row routes use (requireOrgAccess/requireOrgRead → canReadOrg). The legacy
    // readableOrgForOwner consulted only the custom GitHub-OAuth session, which is dormant under the
    // Supabase login wall — so it always returned "public" and a private-org member silently lost the
    // whole recommendation tracker (the list came back empty → read-only roadmap). A private repo is
    // stored under owner-as-org-slug; serve it when the viewer may read that org, otherwise fall back
    // to the shared public org so the anonymous public-scan path still works. (Under-permissioning fix,
    // not a leak — getLatestRecommendations stays org-scoped either way.)
    const ownerOrg = parsed.owner.toLowerCase();
    const orgSlug = (await canReadOrg(ownerOrg)) ? ownerOrg : PUBLIC_ORG;
    const result = await getLatestRecommendations(parsed.owner, parsed.repo, { orgSlug });
    return NextResponse.json(result ?? { scanId: null, items: [] });
  } catch (err) {
    console.error("[recommendations] query failed", err);
    return NextResponse.json({ error: "Failed to load recommendations." }, { status: 500 });
  }
}
