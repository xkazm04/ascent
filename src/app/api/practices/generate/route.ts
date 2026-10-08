// POST /api/practices/generate  { repo: "owner/name", practiceId }  ->  { artifact, shape }
// Preview the concrete, leak-free starter artifact a practice would seed into a repo — the
// "what would land" step before opening a PR. Read-only: one cheap metadata call to tailor the
// artifact (commands, CI matrix) to the repo's language. Works with a GITHUB_TOKEN for private
// repos; public repos need no auth.
//
// `shape` is `{ kind: "house", exemplars }` or `{ kind: "generic" }` — the preview kicker's
// source of truth. Generation goes through `buildPracticeArtifact` so a caller with standing
// reviews the same house-or-generic body apply will commit. Without standing, orgSlug is
// omitted: a generic starter, and mined structure stays inside the org.

import { NextResponse } from "next/server";
import { fetchRepoContext, GitHubError, parseRepoUrl } from "@/lib/github/source";
import { githubErrorHeaders, githubErrorStatus } from "@/lib/api/github-status";
import { respondError } from "@/lib/api/respond";
import { buildPracticeArtifact } from "@/lib/practices/artifact";
import { getInstallationIdForOwner } from "@/lib/db";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { canMintInstallationToken } from "@/lib/authz";
import { withBuildSystem } from "@/lib/practices/build-system";
import { installOwnerFor, MINT_FAILED, resolvePrWriteCoordinate } from "@/lib/github/pr-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { repo?: string; practiceId?: string; org?: string };
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
    // The dashboard org the caller is previewing for. Without it this is today's anonymous preview of
    // a public repo (token-less, generic starter). With it the org's slug — not the repo owner — is
    // the standing check, the tenancy rule, the installation and the house pattern: an org named for
    // its team (`kiro` over `xkazm04/*`) differs from the owner of the repos it tracks.
    const org = typeof body.org === "string" && body.org.trim() ? body.org.trim().toLowerCase() : undefined;
    let standingOrg: string | undefined;
    let mintOwner = parsed.owner.toLowerCase();
    if (org && (await canMintInstallationToken(org))) {
      // Same tenancy rule apply enforces, checked BEFORE any token exists.
      const coordinate = await resolvePrWriteCoordinate(org, body.repo ?? "", "tracked");
      if (coordinate instanceof Response) return coordinate;
      standingOrg = org;
      mintOwner = installOwnerFor(org, coordinate);
    }
    let token = standingOrg ? process.env.GITHUB_TOKEN : undefined;
    if (isAppConfigured() && standingOrg) {
      // A failed lookup or mint is a 502, never a silent downgrade: falling back to no token would
      // make a private repo read as "not found". Only "no installation" (null) keeps the PAT.
      try {
        const id = await getInstallationIdForOwner(mintOwner);
        if (id) token = (await getInstallationToken(id)) || token;
      } catch (err) {
        console.error("[practices/generate] installation token mint failed", err);
        return respondError(502, MINT_FAILED, { cause: err });
      }
    }
    // A JVM repo costs ONE extra call (root listing) so the commands match its build tool; the same
    // helper runs in applyPracticeToRepo, so the preview and the commit agree.
    const ctx = await withBuildSystem(parsed, await fetchRepoContext(parsed, token), token);
    // Same (practiceId, ctx, orgSlug) `applyPracticeToRepo` uses, so the preview body is the
    // commit body and the fingerprint drift-guard can pass. Callers with standing resolve the gated
    // org's mined pattern; anonymous callers omit orgSlug — a generic starter.
    const { artifact, house } = await buildPracticeArtifact(
      body.practiceId,
      ctx,
      standingOrg ? { orgSlug: standingOrg } : {},
    );
    if (!artifact) return NextResponse.json({ error: `Unknown practice "${body.practiceId}".` }, { status: 404 });
    const shape = house
      ? { kind: "house" as const, exemplars: house.exemplars.length }
      : { kind: "generic" as const };
    return NextResponse.json({ artifact, shape });
  } catch (err) {
    if (err instanceof GitHubError) {
      // Was `err.status ?? 502` — GitHub's own status, populated at only some throw sites, which made
      // this route disagree with /api/scan on the SAME error: EMPTY 502 vs 422, INVALID_URL 502 vs
      // 400, and a secondary rate limit 403 vs 429 (the 403 being the one that tells a client to stop
      // rather than to back off). Both routes now read one mapping. Retry-After rides along, which
      // this route previously dropped entirely.
      return respondError(githubErrorStatus(err), err.message, {
        code: err.code,
        headers: githubErrorHeaders(err),
      });
    }
    console.error("[practices/generate] failed", err);
    return respondError(500, "Failed to generate the starter artifact.", { cause: err });
  }
}
