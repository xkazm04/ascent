// POST /api/org/playbooks/:id/apply-batch  { repos: ["owner/name", ...], base? }
//   -> { results: [{ repo, ok, url?, reused?, error? }], attempted, skipped }
// Fleet rollout of an org-authored playbook: open a draft PR seeding it into a whole SEGMENT (or the
// whole fleet) in one action, instead of stepping a dropdown N times. Mirrors
// /api/practices/apply-batch verbatim in shape and in every safety property (G7-24).
//
// THE BOUNDS ON THIS ROUTE — this is the second-most destructive button in the product:
//   1. ROLE. `admin`, never `member`. A fleet-wide PR-write has the blast radius of a segment delete;
//      the practices batch was tightened to admin for exactly this reason and the two must not drift.
//      (The single-repo sibling stays member-level — one PR into one repo is a different act.)
//   2. TENANCY. Every repo must belong to THIS playbook's org (`parseOrgRepo` per coordinate); a
//      mixed-owner batch is refused outright rather than partially applied.
//   3. CAP. MAX_BATCH (25) repos per call, deduped case-insensitively BEFORE the cap so a repeated
//      repo can't burn a slot or race itself on the same `ascent/playbook-<id>-…` branch. Over-cap
//      repos are reported as `skipped`, never silently dropped — so one click can never become
//      hundreds of PRs, and a bigger rollout is an explicit, repeated, re-confirmed act.
//   4. CONCURRENCY. SCAN_CONCURRENCY lanes, so a big fleet doesn't hammer GitHub or trip maxDuration.
// One bad repo never aborts the rest: the per-repo worker owns its errors and the response is a 200
// whatever the mix.

import { NextResponse } from "next/server";
import { isAppConfigured, AppApiError } from "@/lib/github/app";
import { getPlaybook, isDbConfigured } from "@/lib/db";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { parseOrgRepo, resolvePlaybookOrg } from "@/lib/org/playbook-gate";
import { classifyPrWriteError, requirePrWriteContext } from "@/lib/github/pr-route";
import { applyPlaybookToRepo } from "@/lib/org/playbook-apply";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";
import type { BatchResult } from "@/features/shared/practices/practiceApplyShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Cap a single batch so one click can't open hundreds of PRs / run past the function ceiling.
 *  Deliberately the SAME number as the practices batch (see practice-apply-shared MAX_BATCH). */
const MAX_BATCH = 25;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isDbConfigured()) return NextResponse.json({ error: "Playbooks require a database." }, { status: 503 });
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "Opening PRs needs the GitHub App installed with contents + pull-request write access." },
      { status: 503 },
    );
  }
  const actorLogin = await resolveViewerLogin();
  if ((authGateEnabled() || isAuthConfigured()) && !actorLogin) {
    return NextResponse.json({ error: "Sign in to open starter PRs." }, { status: 401 });
  }

  // Resolve the org FROM the playbook, then authorize at the ADMIN floor (bound #1).
  const gated = await resolvePlaybookOrg(id, "admin");
  if (gated instanceof Response) return gated;
  const { org } = gated;

  const body = (await request.json().catch(() => ({}))) as { repos?: string[]; base?: string };
  if (!Array.isArray(body.repos) || body.repos.length === 0) {
    return NextResponse.json({ error: "Provide { repos: ['owner/name', ...] }." }, { status: 400 });
  }

  // Tenancy (bound #2): every coordinate must parse AND belong to this playbook's org. A foreign or
  // typo'd owner fails the whole batch rather than being quietly skipped — a partially-applied
  // cross-tenant rollout is worse than a refused one.
  const parsed: { owner: string; repo: string; fullName: string }[] = [];
  for (const raw of body.repos) {
    const p = parseOrgRepo(raw, org);
    if (p instanceof Response) return p;
    parsed.push(p);
  }

  // Dedupe before the cap (bound #3): the API is a public surface, and two workers for one repo race
  // openDraftPr on the SAME branch — one wins, the other surfaces a confusing ref-exists error plus a
  // burned cap slot and a double adoption/audit row.
  const seen = new Set<string>();
  const unique = parsed.filter((p) => {
    const key = p.fullName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const batch = unique.slice(0, MAX_BATCH);
  const skipped = unique.length - batch.length;

  const playbook = await getPlaybook(id);
  if (!playbook) return NextResponse.json({ error: "Playbook not found." }, { status: 404 });

  try {
    // Install presence (403) + installation-token mint, single-sourced across the PR-write routes.
    const prCtx = await requirePrWriteContext(org);
    if (prCtx instanceof Response) return prCtx;
    const { token } = prCtx;

    const results = await mapPool<(typeof batch)[number], BatchResult>(batch, SCAN_CONCURRENCY, async (p) => {
      try {
        const { pr, fullName } = await applyPlaybookToRepo({
          token,
          org,
          playbook,
          parsed: p,
          base: body.base,
          actorLogin,
          batch: true,
        });
        return { repo: fullName, ok: true, url: pr.url, reused: pr.reused };
      } catch (err) {
        // Single-sourced with the other PR-write routes' error mapping; only the message is used here
        // (the aggregate response is a 200 whatever the per-repo mix).
        const classified = classifyPrWriteError(err);
        return { repo: p.fullName, ok: false, error: classified?.message ?? "Failed to open the playbook PR." };
      }
    });

    return NextResponse.json({ results, attempted: batch.length, skipped });
  } catch (err) {
    if (err instanceof AppApiError) {
      return NextResponse.json({ error: "Failed to mint an installation token for this org." }, { status: 502 });
    }
    console.error("[playbooks/apply-batch] failed", err);
    return NextResponse.json({ error: "Failed to open the playbook PRs." }, { status: 500 });
  }
}
