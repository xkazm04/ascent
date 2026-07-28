// POST /api/practices/apply  { repo: "owner/name", practiceId, base? }  ->  { url, number, reused }
// The "systematic apply" step: open a DRAFT PR that seeds a practice's leak-free starter into the
// repo. Requires the GitHub App installed on the repo's owner with contents + PR write — the same
// installation token used for private scans. Sensitive (it writes to a customer repo), so it's
// gated on a session when auth is configured and every apply is audit-logged.

import { NextResponse } from "next/server";
import { parseRepoUrl } from "@/lib/github/source";
import { applyPracticeToRepo } from "@/lib/practices/apply";
import { isAppConfigured } from "@/lib/github/app";
import { getOrgId } from "@/lib/db";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { mapPrWriteError, requirePrWriteContext } from "@/lib/github/pr-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "Opening a PR needs the GitHub App installed with contents + pull-request write access." },
      { status: 503 },
    );
  }
  // Writing to a customer repo is sensitive — require a signed-in user when auth is configured.
  // The sign-in check used to key on isAuthConfigured() alone -- the DORMANT custom-OAuth env, false
  // in production -- so it never fired there and the actor below was always null. Gate whenever
  // EITHER stack is live (Supabase wall or a dev box with the legacy OAuth configured); a fully
  // auth-off local/demo deployment stays open, exactly as before.
  const actorLogin = await resolveViewerLogin();
  if ((authGateEnabled() || isAuthConfigured()) && !actorLogin) {
    return NextResponse.json({ error: "Sign in to open a starter PR." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    repo?: string;
    practiceId?: string;
    base?: string;
    /** Fingerprint of the previewed artifact body (artifactFingerprint) — apply regenerates, so this
     *  is what guarantees the committed content is the content the user actually reviewed. */
    previewFingerprint?: string;
  };
  const parsed = parseRepoUrl(body.repo ?? "");
  if (!parsed || !body.practiceId) {
    return NextResponse.json({ error: "Provide { repo: 'owner/name', practiceId }." }, { status: 400 });
  }
  // Normalize the owner ONCE (lower-case). Org slugs + memberships are stored lower-cased, so the
  // tenant gate, the installation lookup, and the audit `orgId` must all key off the SAME value — a
  // mixed-case `MyOrg/Repo` would otherwise let the gate/install resolve differently from getOrgId
  // (a lost audit FK, or a mis-passed/mis-failed gate vs the installation).
  parsed.owner = parsed.owner.toLowerCase();

  // Tenant gate: this opens a PR (a WRITE) using the org's installation token, so require the caller
  // to hold at least the "admin" role in that org — not merely be a member. This has the same blast
  // radius as other org-wide mutations (segment delete, credit grants), which already require admin.
  const denied = await requireOrgRole(parsed.owner, "admin");
  if (denied) return denied;

  try {
    // Install presence (403) + installation-token mint, single-sourced across the PR-write routes.
    const ctx = await requirePrWriteContext(parsed.owner);
    if (ctx instanceof Response) return ctx;
    const orgId = (await getOrgId(parsed.owner).catch(() => null)) ?? undefined;
    const result = await applyPracticeToRepo(
      ctx.token,
      parsed,
      body.practiceId,
      body.base,
      { orgId, actorId: actorLogin ?? undefined },
      { expectedFingerprint: typeof body.previewFingerprint === "string" ? body.previewFingerprint : undefined },
    );
    if (result.kind === "unknown-practice") {
      return NextResponse.json({ error: `Unknown practice "${body.practiceId}".` }, { status: 404 });
    }
    if (result.kind === "content-drift") {
      // The repo's context changed since the preview — refuse rather than commit unreviewed content.
      return NextResponse.json(
        { error: "The repo changed since your preview — the starter would differ from what you reviewed. Preview again to see the current version.", code: "content-drift" },
        { status: 409 },
      );
    }

    return NextResponse.json({ ...result.pr, path: result.artifact.path });
  } catch (err) {
    return mapPrWriteError(err, { tag: "practices/apply", genericError: "Failed to open the starter PR." });
  }
}
