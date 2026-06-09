// POST /api/practices/apply  { repo: "owner/name", practiceId, base? }  ->  { url, number, reused }
// The "systematic apply" step: open a DRAFT PR that seeds a practice's leak-free starter into the
// repo. Requires the GitHub App installed on the repo's owner with contents + PR write — the same
// installation token used for private scans. Sensitive (it writes to a customer repo), so it's
// gated on a session when auth is configured and every apply is audit-logged.

import { NextResponse } from "next/server";
import { fetchRepoContext, GitHubError, parseRepoUrl } from "@/lib/github/source";
import { buildArtifact } from "@/lib/practice-artifact";
import { openDraftPr } from "@/lib/github/write";
import { AppApiError, getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { getInstallationIdForOwner, getOrgId, isDbConfigured, recordAudit } from "@/lib/db";
import { getSession, isAuthConfigured } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";

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
  const session = isAuthConfigured() ? await getSession() : null;
  if (isAuthConfigured() && !session) {
    return NextResponse.json({ error: "Sign in to open a starter PR." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { repo?: string; practiceId?: string; base?: string };
  const parsed = parseRepoUrl(body.repo ?? "");
  if (!parsed || !body.practiceId) {
    return NextResponse.json({ error: "Provide { repo: 'owner/name', practiceId }." }, { status: 400 });
  }

  // Tenant gate: this opens a PR (a WRITE) using the org's installation token, so require the caller
  // to OWN that org — not merely be signed in. Without this, any signed-in user could open a draft PR
  // in any org that has the App installed (a cross-tenant write IDOR).
  const denied = await requireOrgAccess(parsed.owner);
  if (denied) return denied;

  const installId = isDbConfigured() ? await getInstallationIdForOwner(parsed.owner).catch(() => null) : null;
  if (!installId) {
    return NextResponse.json(
      { error: `Ascent isn't installed on ${parsed.owner}. Install the GitHub App (with write access) to open PRs.` },
      { status: 403 },
    );
  }

  try {
    const token = await getInstallationToken(installId);
    const ctx = await fetchRepoContext(parsed, token);
    const artifact = buildArtifact(body.practiceId, ctx);
    if (!artifact) return NextResponse.json({ error: `Unknown practice "${body.practiceId}".` }, { status: 404 });

    const pr = await openDraftPr({
      token,
      owner: parsed.owner,
      repo: parsed.repo,
      branch: artifact.branch,
      base: body.base,
      path: artifact.path,
      content: artifact.body,
      commitMessage: artifact.commitMessage,
      prTitle: artifact.prTitle,
      prBody: artifact.prBody,
    });

    const orgId = (await getOrgId(parsed.owner.toLowerCase()).catch(() => null)) ?? undefined;
    await recordAudit(
      "practice.pr_opened",
      { repo: ctx.fullName, practiceId: body.practiceId, path: artifact.path, pr: pr.number, reused: pr.reused },
      { orgId, actorId: session?.login },
    );

    return NextResponse.json({ ...pr, path: artifact.path });
  } catch (err) {
    if (err instanceof AppApiError) {
      // 403 → installation lacks write scope; 404 → repo/branch gone. Surface a clear status.
      const status = err.status === 403 || err.status === 404 ? err.status : 502;
      const hint =
        err.status === 403
          ? "The installation lacks contents/PR write access — update the GitHub App's permissions."
          : "GitHub rejected the write. Check the repo and base branch.";
      return NextResponse.json({ error: hint }, { status });
    }
    if (err instanceof GitHubError) return NextResponse.json({ error: err.message }, { status: err.status ?? 502 });
    console.error("[practices/apply] failed", err);
    return NextResponse.json({ error: "Failed to open the starter PR." }, { status: 500 });
  }
}
