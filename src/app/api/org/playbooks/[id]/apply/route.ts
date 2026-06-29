// POST /api/org/playbooks/:id/apply  { repo: "owner/name", base? }  ->  { url, number, reused }
// Roll out an org-authored playbook by opening a DRAFT PR that seeds the playbook as a tracked
// adoption doc (title, summary, steps as a checklist) into the target repo — the same change-delivery
// mechanism the derived Practice Library already has via /api/practices/apply, now for first-party
// playbooks. Same trust model: GitHub App installed + signed-in + org-owned. On success it also
// records the adoption mark so the playbook's lift analytics light up.

import { NextResponse } from "next/server";
import { parseRepoUrl, fetchRepoContext } from "@/lib/github/source";
import { openDraftPr } from "@/lib/github/write";
import { isAppConfigured } from "@/lib/github/app";
import { applyPlaybook, getPlaybook, isDbConfigured, recordOrgAudit } from "@/lib/db";
import { getSession, isAuthConfigured } from "@/lib/auth";
import { resolvePlaybookOrg } from "@/lib/org/playbook-gate";
import { mapPrWriteError, requirePrWriteContext } from "@/lib/github/pr-route";
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

  // Tenant gate: opening a PR is a WRITE with the org's installation token — resolve the org from the
  // playbook and require org access (member-level, as for the other per-row routes).
  const gated = await resolvePlaybookOrg(id);
  if (gated instanceof Response) return gated;
  const { org } = gated;

  const body = (await request.json().catch(() => ({}))) as { repo?: string; base?: string };
  const parsed = parseRepoUrl(body.repo ?? "");
  if (!parsed) return NextResponse.json({ error: "Provide { repo: 'owner/name' }." }, { status: 400 });
  if (parsed.owner.toLowerCase() !== org.toLowerCase()) {
    return NextResponse.json({ error: `Repo must belong to ${org}.` }, { status: 400 });
  }

  const playbook = await getPlaybook(id);
  if (!playbook) return NextResponse.json({ error: "Playbook not found." }, { status: 404 });

  const dimLabel = DIMENSION_SHORT[playbook.dimId as DimensionId] ?? playbook.dimId;
  const brief = playbookMarkdown(playbook, dimLabel);
  // Single-sourced with the PlaybookCard "Preview starter" so the preview matches what's committed.
  const fileBody = playbookStarterFile(playbook, dimLabel);

  try {
    // Install presence (403) + installation-token mint, single-sourced across the PR-write routes.
    const ctx = await requirePrWriteContext(org);
    if (ctx instanceof Response) return ctx;
    const { token } = ctx;
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
    await recordOrgAudit(
      "playbook.pr_opened",
      org,
      { repo: ctxRepo.fullName, playbookId: id, pr: pr.number, reused: pr.reused },
      session?.login,
    );

    return NextResponse.json(pr);
  } catch (err) {
    // Unified with the sibling PR-write routes. This ALSO gains the 409 "won't overwrite" branch this
    // route previously lacked (it mapped a base-file collision to a 502 "write rejected") — a deliberate
    // drift fix: a 409 from openDraftPr's overwrite guard now surfaces as 409, matching practices/apply.
    return mapPrWriteError(err, { tag: "playbooks/apply", genericError: "Failed to open the playbook PR." });
  }
}
