// POST /api/org/playbooks/:id/apply  { repo: "owner/name", base? }  ->  { url, number, reused }
// Roll out an org-authored playbook by opening a DRAFT PR that seeds the playbook as a tracked
// adoption doc (title, summary, steps as a checklist) into the target repo — the same change-delivery
// mechanism the derived Practice Library already has via /api/practices/apply, now for first-party
// playbooks. Same trust model: GitHub App installed + signed-in + org-owned. On success it also
// records the adoption mark so the playbook's lift analytics light up.

import { NextResponse } from "next/server";
import { parseRepoUrl, fetchRepoContext, GitHubError } from "@/lib/github/source";
import { openDraftPr } from "@/lib/github/write";
import { AppApiError, getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { applyPlaybook, getOrgId, getPlaybook, getPlaybookOrgSlug, getInstallationIdForOwner, isDbConfigured, recordAudit } from "@/lib/db";
import { getSession, isAuthConfigured } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";
import { playbookMarkdown, playbookStarterFile } from "@/lib/org/playbook-brief";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "playbook";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isDbConfigured()) return NextResponse.json({ error: "Playbooks require a database." }, { status: 503 });
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "Opening a PR needs the GitHub App installed with contents + pull-request write access." },
      { status: 503 },
    );
  }
  const session = isAuthConfigured() ? await getSession() : null;
  if (isAuthConfigured() && !session) {
    return NextResponse.json({ error: "Sign in to open a playbook PR." }, { status: 401 });
  }

  const org = await getPlaybookOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Playbook not found." }, { status: 404 });

  // Tenant gate: opening a PR is a WRITE with the org's installation token — require org ownership.
  const denied = await requireOrgAccess(org);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { repo?: string; base?: string };
  const parsed = parseRepoUrl(body.repo ?? "");
  if (!parsed) return NextResponse.json({ error: "Provide { repo: 'owner/name' }." }, { status: 400 });
  if (parsed.owner.toLowerCase() !== org.toLowerCase()) {
    return NextResponse.json({ error: `Repo must belong to ${org}.` }, { status: 400 });
  }

  const playbook = await getPlaybook(id);
  if (!playbook) return NextResponse.json({ error: "Playbook not found." }, { status: 404 });

  const installId = await getInstallationIdForOwner(org).catch(() => null);
  if (!installId) {
    return NextResponse.json(
      { error: `Ascent isn't installed on ${org}. Install the GitHub App (with write access) to open PRs.` },
      { status: 403 },
    );
  }

  const dimLabel = DIMENSION_SHORT[playbook.dimId as DimensionId] ?? playbook.dimId;
  const brief = playbookMarkdown(playbook, dimLabel);
  // Single-sourced with the PlaybookCard "Preview starter" so the preview matches what's committed.
  const fileBody = playbookStarterFile(playbook, dimLabel);

  try {
    const token = await getInstallationToken(installId);
    const ctxRepo = await fetchRepoContext(parsed, token);
    const pr = await openDraftPr({
      token,
      owner: parsed.owner,
      repo: parsed.repo,
      branch: `ascent/playbook-${slug(playbook.title)}`,
      base: body.base,
      path: `docs/playbooks/${slug(playbook.title)}.md`,
      content: fileBody,
      commitMessage: `docs: adopt "${playbook.title}" playbook (via Ascent)`,
      prTitle: `Adopt playbook: ${playbook.title}`,
      prBody: brief,
    });

    // Record the adoption mark (idempotent) so lift analytics include this repo, and audit the write.
    await applyPlaybook(org, id, ctxRepo.fullName, session?.login ?? null);
    const orgId = (await getOrgId(org.toLowerCase()).catch(() => null)) ?? undefined;
    await recordAudit(
      "playbook.pr_opened",
      { repo: ctxRepo.fullName, playbookId: id, pr: pr.number, reused: pr.reused },
      { orgId, actorId: session?.login },
    );

    return NextResponse.json(pr);
  } catch (err) {
    if (err instanceof AppApiError) {
      const status = err.status === 403 || err.status === 404 ? err.status : 502;
      const hint =
        err.status === 403
          ? "The installation lacks contents/PR write access — update the GitHub App's permissions."
          : "GitHub rejected the write. Check the repo and base branch.";
      return NextResponse.json({ error: hint }, { status });
    }
    if (err instanceof GitHubError) return NextResponse.json({ error: err.message }, { status: err.status ?? 502 });
    console.error("[playbooks/apply] failed", err);
    return NextResponse.json({ error: "Failed to open the playbook PR." }, { status: 500 });
  }
}
