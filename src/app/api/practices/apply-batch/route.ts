// POST /api/practices/apply-batch  { repos: ["owner/name", ...], practiceId, base? }
//   -> { results: [{ repo, ok, url?, number?, reused?, error? }], attempted, skipped }
// Fleet rollout of the "systematic apply" step: open a draft PR seeding a practice's leak-free
// starter into EVERY gap repo in one action, instead of clicking through a dropdown N times. Same
// trust model as /api/practices/apply (App installed + signed-in + org-owned) — all repos must
// belong to one org, gated once, then fanned out with bounded concurrency so a big fleet doesn't
// hammer GitHub or trip the function timeout. One bad repo never aborts the rest.

import { NextResponse } from "next/server";
import { fetchRepoContext, GitHubError, parseRepoUrl } from "@/lib/github/source";
import { buildArtifact } from "@/lib/practice-artifact";
import { openDraftPr } from "@/lib/github/write";
import { AppApiError, getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { getInstallationIdForOwner, getOrgId, isDbConfigured, recordAudit } from "@/lib/db";
import { getSession, isAuthConfigured } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Cap a single batch so one click can't open hundreds of PRs / run past the function ceiling. */
const MAX_BATCH = 25;

interface RepoResult {
  repo: string;
  ok: boolean;
  url?: string;
  number?: number;
  reused?: boolean;
  error?: string;
}

export async function POST(request: Request) {
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "Opening PRs needs the GitHub App installed with contents + pull-request write access." },
      { status: 503 },
    );
  }
  const session = isAuthConfigured() ? await getSession() : null;
  if (isAuthConfigured() && !session) {
    return NextResponse.json({ error: "Sign in to open starter PRs." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { repos?: string[]; practiceId?: string; base?: string };
  if (!body.practiceId || !Array.isArray(body.repos) || body.repos.length === 0) {
    return NextResponse.json({ error: "Provide { repos: ['owner/name', ...], practiceId }." }, { status: 400 });
  }

  // Parse + validate; every repo must belong to ONE org so a single tenant gate covers the batch.
  const parsed = body.repos
    .map((raw) => ({ raw, ref: parseRepoUrl(raw) }))
    .filter((x): x is { raw: string; ref: NonNullable<ReturnType<typeof parseRepoUrl>> } => !!x.ref);
  if (parsed.length === 0) {
    return NextResponse.json({ error: "No valid 'owner/name' repos in the batch." }, { status: 400 });
  }
  const owners = new Set(parsed.map((x) => x.ref.owner.toLowerCase()));
  if (owners.size > 1) {
    return NextResponse.json({ error: "All repos in a batch must belong to the same org." }, { status: 400 });
  }
  const owner = parsed[0]!.ref.owner;

  // Tenant gate: this opens PRs (WRITES) with the org's installation token — require org ownership.
  const denied = await requireOrgAccess(owner);
  if (denied) return denied;

  const installId = isDbConfigured() ? await getInstallationIdForOwner(owner).catch(() => null) : null;
  if (!installId) {
    return NextResponse.json(
      { error: `Ascent isn't installed on ${owner}. Install the GitHub App (with write access) to open PRs.` },
      { status: 403 },
    );
  }

  const batch = parsed.slice(0, MAX_BATCH);
  const skipped = parsed.length - batch.length;

  try {
    const token = await getInstallationToken(installId);
    const orgId = (await getOrgId(owner.toLowerCase()).catch(() => null)) ?? undefined;

    // Bounded fan-out; the per-repo worker owns its errors so one failure can't abort the pool.
    const results = await mapPool<typeof batch[number], RepoResult>(batch, SCAN_CONCURRENCY, async ({ raw, ref }) => {
      try {
        const ctx = await fetchRepoContext(ref, token);
        const artifact = buildArtifact(body.practiceId!, ctx);
        if (!artifact) return { repo: ctx.fullName, ok: false, error: `Unknown practice "${body.practiceId}".` };
        const pr = await openDraftPr({
          token,
          owner: ref.owner,
          repo: ref.repo,
          branch: artifact.branch,
          base: body.base,
          path: artifact.path,
          content: artifact.body,
          commitMessage: artifact.commitMessage,
          prTitle: artifact.prTitle,
          prBody: artifact.prBody,
        });
        await recordAudit(
          "practice.pr_opened",
          { repo: ctx.fullName, practiceId: body.practiceId, path: artifact.path, pr: pr.number, reused: pr.reused, batch: true },
          { orgId, actorId: session?.login },
        );
        return { repo: ctx.fullName, ok: true, url: pr.url, number: pr.number, reused: pr.reused };
      } catch (err) {
        let msg = "Failed to open the starter PR.";
        if (err instanceof AppApiError) {
          msg = err.status === 403 ? "Installation lacks contents/PR write access." : "GitHub rejected the write.";
        } else if (err instanceof GitHubError) {
          msg = err.message;
        }
        return { repo: raw, ok: false, error: msg };
      }
    });

    return NextResponse.json({ results, attempted: batch.length, skipped });
  } catch (err) {
    if (err instanceof AppApiError) {
      return NextResponse.json({ error: "Failed to mint an installation token for this org." }, { status: 502 });
    }
    console.error("[practices/apply-batch] failed", err);
    return NextResponse.json({ error: "Failed to open the starter PRs." }, { status: 500 });
  }
}
