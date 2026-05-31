// GET /api/history?repo=owner/repo  ->  prior scans + per-dimension scores (trends).
// Requires DATABASE_URL (Phase 2). Returns 503 when persistence is disabled.

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { getRepositoryHistory, isDbConfigured } from "@/lib/db";
import { getSession, isAuthConfigured, readableOrgForOwner } from "@/lib/auth";

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
      { error: "History is unavailable: no database configured (Phase 2 feature)." },
      { status: 503 },
    );
  }

  // Gate behind a session when auth is configured, mirroring the /trends page this API
  // feeds. The org-scoping below already prevents cross-tenant reads (an unauthenticated
  // caller resolves to the "public" org), but requiring sign-in keeps the API and page in
  // lockstep and blocks anonymous enumeration of owner/repo slugs. Auth-off (local/demo)
  // deployments skip the gate, consistent with the rest of the app.
  if (isAuthConfigured() && !(await getSession())) {
    return NextResponse.json({ error: "Sign in to view history." }, { status: 401 });
  }

  try {
    // Scope to the org the caller may read (own org via session, else public) so a
    // name collision can't leak another tenant's history.
    const orgSlug = await readableOrgForOwner(parsed.owner);
    const history = await getRepositoryHistory(parsed.owner, parsed.repo, { orgSlug });
    if (!history) {
      return NextResponse.json(
        { repo: { owner: parsed.owner, name: parsed.repo, fullName: `${parsed.owner}/${parsed.repo}` }, scans: [] },
      );
    }
    return NextResponse.json(history);
  } catch (err) {
    console.error("[history] query failed", err);
    return NextResponse.json({ error: "Failed to load history." }, { status: 500 });
  }
}
