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
    // `?dims=0` requests the lightweight overall-only series (skips the per-dimension fan-out) for
    // callers that chart only the overall line; the default still returns per-dimension scores.
    const includeDimensions = searchParams.get("dims") !== "0";
    const history = await getRepositoryHistory(parsed.owner, parsed.repo, { orgSlug, includeDimensions });
    const payload =
      history ??
      { repo: { owner: parsed.owner, name: parsed.repo, fullName: `${parsed.owner}/${parsed.repo}` }, scans: [] };

    // A repo's history is append-only: existing scan points are immutable snapshots; only new
    // points append. So a weak validator over (mode, count, newest-scan-id) changes iff a new scan
    // landed (the mode marker keeps the light and full responses from sharing an ETag). Emit it and
    // answer a matching If-None-Match with a free 304 so the /trends page and any pollers don't
    // re-transfer an unchanged series. Caching is `private` (not `s-maxage`): the payload is
    // org-scoped and may be auth-gated, so it must never sit in a shared proxy cache where another
    // tenant could receive it.
    const etag = `W/"h${includeDimensions ? "f" : "l"}${payload.scans.length}-${payload.scans[0]?.id ?? "none"}"`;
    const headers: Record<string, string> = {
      etag,
      "cache-control": "private, max-age=30, stale-while-revalidate=300",
    };
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers });
    }
    return NextResponse.json(payload, { headers });
  } catch (err) {
    console.error("[history] query failed", err);
    return NextResponse.json({ error: "Failed to load history." }, { status: 500 });
  }
}
