// GET /api/org/repos?org=X&count=N  →  { org, repos: OrgRepoListItem[] }
//
// Lists an org's (or user's) most-recently-pushed public repositories, for the onboarding
// selector. Token-based (GITHUB_TOKEN) — no GitHub App required. Signed-in users with a GitHub
// App installation get the private-repo path in onboarding via /api/app/repos (listInstallationRepos);
// this endpoint stays the public, App-free listing for the free-tier funnel.

import { NextResponse } from "next/server";
import { GitHubListError, listOrgRepos } from "@/lib/github/list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org")?.trim().toLowerCase();
  if (!org) return NextResponse.json({ error: "Missing 'org' query parameter." }, { status: 400 });
  const count = Math.min(50, Math.max(1, Number(searchParams.get("count") ?? 30)));

  try {
    const repos = await listOrgRepos(org, count, process.env.GITHUB_TOKEN || undefined);
    return NextResponse.json({ org, repos });
  } catch (err) {
    // Map the listing failure to the RIGHT status — a rate limit / auth outage must not read as a 404
    // "no such org" (which made a real account on a busy shared token look like a typo).
    if (err instanceof GitHubListError) {
      const status = err.code === "RATE_LIMITED" ? 429 : err.code === "NOT_FOUND" ? 404 : 502;
      const headers = err.retryAfterSec ? { "retry-after": String(err.retryAfterSec) } : undefined;
      return NextResponse.json({ error: err.message, code: err.code }, { status, headers });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : `Could not list repositories for "${org}".` },
      { status: 502 },
    );
  }
}
