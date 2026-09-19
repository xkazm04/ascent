// GET /api/org/repos?org=X&count=N  →  { org, repos: OrgRepoListItem[] }
//
// Lists an org's (or user's) most-recently-pushed public repositories, for the onboarding
// selector. Token-based (GITHUB_TOKEN) — no GitHub App required. Signed-in users with a GitHub
// App installation get the private-repo path in onboarding via /api/app/repos (listInstallationRepos);
// this endpoint stays the public, App-free listing for the free-tier funnel.

import { NextResponse } from "next/server";
import { GitHubListError, listOrgRepos } from "@/lib/github/list";
import { normalizeOrgSlug } from "@/lib/db/org-shared";
import { rateLimitRequest, tooManyRequests, ORG_REPOS_RATE_LIMIT } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org") ? normalizeOrgSlug(searchParams.get("org")!) : undefined;
  if (!org) return NextResponse.json({ error: "Missing 'org' query parameter." }, { status: 400 });

  // Public and App-free by design — which is exactly why it needs a limiter. Each call fans out to up
  // to 5 GitHub pages on the server's AMBIENT token, so an anonymous loop over invented org names
  // spends the operator's quota, not the caller's. Checked AFTER the cheap arg validation so a
  // malformed request costs a 400 rather than a limiter slot.
  const rl = rateLimitRequest(request, ORG_REPOS_RATE_LIMIT);
  if (!rl.ok) return tooManyRequests(rl);
  const count = Math.min(50, Math.max(1, Number(searchParams.get("count") ?? 30)));

  try {
    const { repos, truncated } = await listOrgRepos(org, count, process.env.GITHUB_TOKEN || undefined);
    // `truncated` distinguishes "the org only has this many listable repos" from "the listing's page
    // budget ran out with more pages available" (fork/archive-heavy orgs beyond 500 raw repos), so the
    // onboarding selector can say "showing the most recent N" instead of presenting the list as complete.
    return NextResponse.json({ org, repos, truncated });
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
