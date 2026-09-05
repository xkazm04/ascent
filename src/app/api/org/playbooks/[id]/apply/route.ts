// POST /api/org/playbooks/:id/apply  { repo: "owner/name", base? }  ->  { url, number, reused }
// Roll out an org-authored playbook by opening a DRAFT PR that seeds the playbook as a tracked
// adoption doc (title, summary, steps as a checklist) into the target repo — the same change-delivery
// mechanism the derived Practice Library already has via /api/practices/apply, now for first-party
// playbooks. Same trust model: GitHub App installed + signed-in + org-owned. On success it also
// records the adoption mark so the playbook's lift analytics light up.
//
// The write sequence itself lives in @/lib/org/playbook-apply, shared with the fleet `apply-batch`
// sibling; this route owns only its gating and its one-status error mapping.

import { NextResponse } from "next/server";
import { isAppConfigured } from "@/lib/github/app";
import { getPlaybook, isDbConfigured } from "@/lib/db";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { parseOrgRepo, resolvePlaybookOrg } from "@/lib/org/playbook-gate";
import { mapPrWriteError, requirePrWriteContext } from "@/lib/github/pr-route";
import { applyPlaybookToRepo } from "@/lib/org/playbook-apply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isDbConfigured()) return NextResponse.json({ error: "Playbooks require a database." }, { status: 503 });
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "Opening a PR needs the GitHub App installed with contents + pull-request write access." },
      { status: 503 },
    );
  }
  // The sign-in check used to key on isAuthConfigured() alone -- the DORMANT custom-OAuth env, false
  // in production -- so it never fired there and the actor below was always null. Gate whenever
  // EITHER stack is live (Supabase wall or a dev box with the legacy OAuth configured); a fully
  // auth-off local/demo deployment stays open, exactly as before.
  const actorLogin = await resolveViewerLogin();
  if ((authGateEnabled() || isAuthConfigured()) && !actorLogin) {
    return NextResponse.json({ error: "Sign in to open a playbook PR." }, { status: 401 });
  }

  // Tenant gate: opening a PR is a WRITE with the org's installation token — resolve the org from the
  // playbook and require org access (member-level, as for the other per-row routes).
  const gated = await resolvePlaybookOrg(id);
  if (gated instanceof Response) return gated;
  const { org } = gated;

  const body = (await request.json().catch(() => ({}))) as { repo?: string; base?: string };
  // Tenant gate on the repo coordinate (shared with [id]/repos via parseOrgRepo): require the repo to
  // belong to this playbook's org.
  const parsed = parseOrgRepo(body.repo, org);
  if (parsed instanceof Response) return parsed;

  const playbook = await getPlaybook(id);
  if (!playbook) return NextResponse.json({ error: "Playbook not found." }, { status: 404 });

  try {
    // Install presence (403) + installation-token mint, single-sourced across the PR-write routes.
    const prCtx = await requirePrWriteContext(org);
    if (prCtx instanceof Response) return prCtx;
    const { pr } = await applyPlaybookToRepo({
      token: prCtx.token,
      org,
      playbook,
      parsed,
      base: body.base,
      actorLogin,
    });
    return NextResponse.json(pr);
  } catch (err) {
    // Unified with the sibling PR-write routes. This ALSO gains the 409 "won't overwrite" branch this
    // route previously lacked (it mapped a base-file collision to a 502 "write rejected") — a deliberate
    // drift fix: a 409 from openDraftPr's overwrite guard now surfaces as 409, matching practices/apply.
    return mapPrWriteError(err, { tag: "playbooks/apply", genericError: "Failed to open the playbook PR." });
  }
}
