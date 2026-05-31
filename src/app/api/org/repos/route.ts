// GET /api/org/repos?org=X&count=N  →  { org, repos: OrgRepoListItem[] }
//
// Lists an org's (or user's) most-recently-pushed public repositories, for the onboarding
// selector. Token-based (GITHUB_TOKEN) — no GitHub App required. With the App configured, a
// future enhancement can list a signed-in user's private installation repos here instead.

import { NextResponse } from "next/server";
import { listOrgRepos } from "@/lib/github/list";

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
    return NextResponse.json(
      { error: err instanceof Error ? err.message : `Could not list repositories for "${org}".` },
      { status: 404 },
    );
  }
}
