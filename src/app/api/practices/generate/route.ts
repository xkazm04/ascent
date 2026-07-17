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
import { canMintInstallationToken } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { repo?: string; practiceId?: string };
  const parsed = parseRepoUrl(body.repo ?? "");
  if (!parsed || !body.practiceId) {
    return NextResponse.json({ error: "Provide { repo: 'owner/name', practiceId }." }, { status: 400 });
  }

  try {
    // Prefer an installation token (private repos), else the public token. Mint the org's installation
    // token ONLY for a caller with real standing in that org — otherwise an anonymous caller could
    // read any installed org's PRIVATE repo metadata via this preview.
    //
    // The old guard was `!isAuthConfigured() || sessionOwnsOrg(owner)`. isAuthConfigured() keys on the
    // DORMANT custom-OAuth env, unset in production, so `!false` short-circuited the whole check and
    // the ownership test never ran: any caller could mint. canMintInstallationToken resolves real
    // membership against the ACTIVE Supabase wall (mirrors resolveScanAuth in src/lib/scan.ts).
    // The ambient operator PAT is gated on the CALLER'S STANDING, not on whether the owner has an App
    // installation. The old guard dropped the PAT only for installed owners, so for any NON-installed
    // owner an anonymous caller still probed private repo metadata (name, description, language,
    // default branch) through the operator's broad-read PAT — "every private repo the PAT can read
    // belongs to an installed org" was an unstated, untrue assumption. Now: no standing ⇒ no token at
    // all (token-less fetch keeps public repos working; a private repo 404s cleanly below).
    const callerHasStanding = await canMintInstallationToken(parsed.owner);
    let token = callerHasStanding ? process.env.GITHUB_TOKEN : undefined;
    if (isAppConfigured() && callerHasStanding) {
      const id = await getInstallationIdForOwner(parsed.owner).catch(() => null);
      if (id) {
        const minted = await getInstallationToken(id).catch(() => undefined);
        if (minted) token = minted;
      }
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
