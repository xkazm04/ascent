// POST /api/report/foundation/pr-batch { org, repos: ["owner/name", ...], base? }
//   -> { results: FoundationBatchItem[], attempted, skipped }
//
// Fleet rollout of the `.ai/` foundation: open (or update) the install PR in EVERY repo an org just
// scanned, from one click, instead of N trips through /api/report/foundation/pr. The single-repo route
// is unchanged and remains the per-repo door.
//
// Trust model is the SAME as that route and as /api/practices/apply-batch, deliberately — this is the
// same customer-repo WRITE at a different scale: db + App configured, same-origin, signed-in, the repos
// resolve to ONE org, and org ADMIN. It reuses requirePrWriteContext for the installation gate + token
// mint, so a change to that copy lands here too.
//
// One repo's failure is never fatal: openFoundationPrBatch's per-repo worker owns its errors, so the
// response is always a 200 with one row per repo (an unscanned repo is `ok:false, error:"No saved
// scan…"`, an already-installed repo carries GitHub's own 409 message).

import { NextResponse } from "next/server";
import { AppApiError, isAppConfigured } from "@/lib/github/app";
import { getScanReportByCommit, isDbConfigured, recordOrgAudit } from "@/lib/db";
import { PUBLIC_ORG, isAuthConfigured, requireSameOrigin, readableOrgForOwner } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
import { requirePrWriteContext } from "@/lib/github/pr-route";
import { parseRepoUrl } from "@/lib/github/source";
import { buildFoundation } from "@/lib/standard";
import { openFoundationPrBatch, type FoundationBatchItem } from "@/lib/standard/pr";
import type { GeneratedFile } from "@/lib/standard/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Cap one batch so a single click can't open hundreds of PRs / run past the function ceiling. */
const MAX_BATCH = 25;

const PR_TITLE = "Install the .ai/ AI-native foundation";
const PR_BODY =
  "Seeds the `.ai/` foundation Ascent generated from this repo's latest scan: the agent-facing " +
  "contract (`.ai/manifest.yaml`), the executable conformance check (`.ai/doctor.mjs`) and its CI " +
  "backstop, the upkeep script, the durable memory store, and the CONTEXT graph seed.\n\n" +
  "Next: adapt every `TODO` to this repo, wire `node .ai/doctor.mjs` into your existing pre-push " +
  "hook, then run it for a conformance baseline. Sibling to the descriptive `.ai/passport.json`.";

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Installing the foundation requires a database." }, { status: 503 });
  }
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "Opening PRs needs the GitHub App installed with contents + pull-request write access." },
      { status: 503 },
    );
  }
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const actorLogin = await resolveViewerLogin();
  if ((authGateEnabled() || isAuthConfigured()) && !actorLogin) {
    return NextResponse.json({ error: "Sign in to open foundation PRs." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { org?: string; repos?: string[]; base?: string };
  if (!Array.isArray(body.repos) || body.repos.length === 0) {
    return NextResponse.json({ error: "Provide { org, repos: ['owner/name', ...] }." }, { status: 400 });
  }
  const parsed = body.repos
    .map((raw) => parseRepoUrl(raw))
    .filter((r): r is NonNullable<ReturnType<typeof parseRepoUrl>> => !!r);
  if (parsed.length === 0) {
    return NextResponse.json({ error: "No valid 'owner/name' repos in the batch." }, { status: 400 });
  }
  // ONE org per batch, so a single tenant gate genuinely covers every write in the fan-out.
  const owners = new Set(parsed.map((r) => r.owner.toLowerCase()));
  if (owners.size > 1) {
    return NextResponse.json({ error: "All repos in a batch must belong to the same org." }, { status: 400 });
  }
  const owner = parsed[0]!.owner;

  const org = await readableOrgForOwner(owner);
  if (org === PUBLIC_ORG) {
    return NextResponse.json({ error: "Foundation PRs are only for org-owned repositories." }, { status: 403 });
  }
  // A caller-supplied `org` must never widen the gate: it is only accepted when it AGREES with the org
  // the repo owner actually resolves to, so the batch can't be gated against one tenant and written
  // into another's repos.
  if (body.org && body.org.trim().toLowerCase() !== org.toLowerCase()) {
    return NextResponse.json({ error: "The repos in this batch don't belong to that org." }, { status: 403 });
  }
  // Same threshold as the single-repo route and apply-batch: this WRITES into customer repos with the
  // org's installation token, so membership is not enough.
  const denied = await requireOrgRole(org, "admin");
  if (denied) return denied;

  // Dedupe BEFORE the cap: two workers for one repo race openDraftPr on the same FOUNDATION_BRANCH —
  // one wins, the other surfaces a confusing ref error, and a cap slot plus an audit row are burned.
  const seen = new Set<string>();
  const unique = parsed.filter((r) => {
    const key = `${r.owner}/${r.repo}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const batch = unique.slice(0, MAX_BATCH);
  const skipped = unique.length - batch.length;

  try {
    const ctx = await requirePrWriteContext(org);
    if (ctx instanceof Response) return ctx;
    const { token } = ctx;

    // The foundation is generated FROM each repo's persisted scan, so a repo with no saved scan has
    // nothing to install. That is a per-repo REPORTED outcome, never an abort — a fleet where one repo
    // was never scanned must still get the other twenty-four installs.
    const prepared: Array<{ name: string; files: GeneratedFile[]; prTitle: string; prBody: string }> = [];
    const unscanned: FoundationBatchItem[] = [];
    for (const r of batch) {
      const report = await getScanReportByCommit(r.owner, r.repo, { orgSlug: org }).catch(() => null);
      if (!report) {
        unscanned.push({
          repo: `${r.owner}/${r.repo}`,
          ok: false,
          error: "No saved scan for this repository yet. Scan it first, then install.",
        });
        continue;
      }
      prepared.push({ name: r.repo, files: buildFoundation(report), prTitle: PR_TITLE, prBody: PR_BODY });
    }

    const opened = await openFoundationPrBatch({ token, owner, base: body.base, repos: prepared });

    // Per-repo audit rows FIRST, so the rollout read (getFoundationRollout) sees a batch install and a
    // single install identically — the panel must not care which door a repo came through. Then one
    // batch row for the act itself.
    for (const item of opened) {
      if (!item.ok) continue;
      await recordOrgAudit(
        "foundation.pr_opened",
        org,
        { repo: item.repo, pr: item.number, reused: item.reused, committed: item.committed, skipped: item.skipped, batch: true },
        actorLogin ?? undefined,
      );
    }
    const results = [...opened, ...unscanned];
    await recordOrgAudit(
      "foundation.batch_opened",
      org,
      {
        repos: batch.length,
        opened: opened.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        skipped,
      },
      actorLogin ?? undefined,
    );

    return NextResponse.json({ results, attempted: batch.length, skipped });
  } catch (err) {
    if (err instanceof AppApiError) {
      return NextResponse.json({ error: "Failed to mint an installation token for this org." }, { status: 502 });
    }
    console.error("[foundation/pr-batch] failed", err);
    return NextResponse.json({ error: "Failed to open the foundation PRs." }, { status: 500 });
  }
}
