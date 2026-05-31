// POST /api/practices/generate  { repo: "owner/name", practiceId }  ->  { artifact }
// Preview the concrete, leak-free starter artifact a practice would seed into a repo — the
// "what would land" step before opening a PR. Read-only: one cheap metadata call to tailor the
// artifact (commands, CI matrix) to the repo's language. Works with a GITHUB_TOKEN for private
// repos; public repos need no auth.

import { NextResponse } from "next/server";
import { fetchRepoContext, GitHubError, parseRepoUrl } from "@/lib/github/source";
import { buildArtifact } from "@/lib/practice-artifact";
import { getInstallationIdForOwner } from "@/lib/db";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { repo?: string; practiceId?: string };
  const parsed = parseRepoUrl(body.repo ?? "");
  if (!parsed || !body.practiceId) {
    return NextResponse.json({ error: "Provide { repo: 'owner/name', practiceId }." }, { status: 400 });
  }

  try {
    // Prefer an installation token (private repos), else the public token.
    let token = process.env.GITHUB_TOKEN;
    if (isAppConfigured()) {
      const id = await getInstallationIdForOwner(parsed.owner).catch(() => null);
      if (id) token = await getInstallationToken(id).catch(() => token);
    }
    const ctx = await fetchRepoContext(parsed, token);
    const artifact = buildArtifact(body.practiceId, ctx);
    if (!artifact) return NextResponse.json({ error: `Unknown practice "${body.practiceId}".` }, { status: 404 });
    return NextResponse.json({ artifact });
  } catch (err) {
    if (err instanceof GitHubError) {
      return NextResponse.json({ error: err.message }, { status: err.status ?? 502 });
    }
    console.error("[practices/generate] failed", err);
    return NextResponse.json({ error: "Failed to generate the starter artifact." }, { status: 500 });
  }
}
