// POST /api/report/passport/pr { repo: "owner/name", base? }  ->  { url, number, reused }
// Open a DRAFT PR that seeds the repo's App Readiness Passport as `.ai/passport.json` (co-located with
// the agent standard) — the same change-delivery path the playbooks/practices use. The committed file
// is the stored passport (overrides applied), with the schema pointer. Org-owned + GitHub-App-installed
// + signed-in; openDraftPr refuses to clobber an existing `.ai/passport.json` on the base branch.

import { NextResponse } from "next/server";
import { GitHubError } from "@/lib/github/source";
import { openDraftPr } from "@/lib/github/write";
import { AppApiError, getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { getInstallationIdForOwner, getOrgId, getRepoPassport, isDbConfigured, recordAudit } from "@/lib/db";
import { PUBLIC_ORG, getSession, isAuthConfigured, isSameOrigin, readableOrgForOwner } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function parseRepo(q: string): { owner: string; name: string } | null {
  const slash = q.indexOf("/");
  if (slash <= 0 || slash === q.length - 1 || q.indexOf("/", slash + 1) >= 0) return null;
  return { owner: q.slice(0, slash), name: q.slice(slash + 1) };
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Passport export requires a database." }, { status: 503 });
  if (!isAppConfigured()) {
    return NextResponse.json({ error: "Opening a PR needs the GitHub App installed with contents + pull-request write access." }, { status: 503 });
  }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  if (isAuthConfigured() && !(await getSession())) {
    return NextResponse.json({ error: "Sign in to open a passport PR." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { repo?: string; base?: string };
  const parsed = body.repo ? parseRepo(body.repo) : null;
  if (!parsed) return NextResponse.json({ error: "Provide { repo: 'owner/name' }." }, { status: 400 });

  const org = await readableOrgForOwner(parsed.owner);
  if (org === PUBLIC_ORG) {
    return NextResponse.json({ error: "Passport PRs are only for org-owned repositories." }, { status: 403 });
  }
  // Opening a PR is a WRITE with the org's installation token — gate on org access.
  const denied = await requireOrgAccess(org);
  if (denied) return denied;

  const passport = await getRepoPassport(parsed.owner, parsed.name, { orgSlug: org }).catch(() => null);
  if (!passport) {
    return NextResponse.json({ error: "No passport for this repository yet. Scan it first." }, { status: 404 });
  }
  const installId = await getInstallationIdForOwner(org).catch(() => null);
  if (!installId) {
    return NextResponse.json({ error: `Ascent isn't installed on ${org}. Install the GitHub App (with write access) to open PRs.` }, { status: 403 });
  }

  // The committed file: schema pointer first, then the (override-applied) passport.
  const fileContent = JSON.stringify({ $schema: "https://ascent.dev/schemas/app-passport-0.1.json", ...passport }, null, 2) + "\n";
  const session = await getSession();
  try {
    const token = await getInstallationToken(installId);
    const pr = await openDraftPr({
      token,
      owner: parsed.owner,
      repo: parsed.name,
      branch: "ascent/app-passport",
      base: body.base,
      path: ".ai/passport.json",
      content: fileContent,
      commitMessage: "chore: add App Readiness Passport (.ai/passport.json, via Ascent)",
      prTitle: "Add App Readiness Passport",
      prBody: `Seeds \`.ai/passport.json\` — the portfolio readiness scorecard Ascent derived from this repo's latest scan (automation **${passport.automationReadiness.level}** · production **${passport.productionReadiness.band}**). Descriptive + tool-naming; sibling to the agent-facing \`.ai/manifest.yaml\`. Regenerate it from a fresh scan when the stack drifts.`,
    });
    const orgId = (await getOrgId(org.toLowerCase()).catch(() => null)) ?? undefined;
    await recordAudit("passport.pr_opened", { repo: `${parsed.owner}/${parsed.name}`, pr: pr.number, reused: pr.reused }, { orgId, actorId: session?.login });
    return NextResponse.json(pr);
  } catch (err) {
    if (err instanceof AppApiError) {
      const status = err.status === 403 || err.status === 404 || err.status === 409 ? err.status : 502;
      const hint =
        err.status === 409
          ? err.message
          : err.status === 403
            ? "The installation lacks contents/PR write access — update the GitHub App's permissions."
            : "GitHub rejected the write. Check the repo and base branch.";
      return NextResponse.json({ error: hint }, { status });
    }
    if (err instanceof GitHubError) return NextResponse.json({ error: err.message }, { status: err.status ?? 502 });
    console.error("[passport/pr] failed", err);
    return NextResponse.json({ error: "Failed to open the passport PR." }, { status: 500 });
  }
}
