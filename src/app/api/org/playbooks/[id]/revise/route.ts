// GET  /api/org/playbooks/:id/revise
//   -> { version, behind: [{ repo, appliedVersion }], diverged, unversioned, current, inFlight }   (member)
// POST /api/org/playbooks/:id/revise  { repos: ["owner/name", ...], base?, dryRun?: true }      (admin)
//   -> { results: [{ repo, ok, url?, reused?, error? }], attempted, skipped }
//   -> dryRun { repos, fromVersions, toVersion, starter, skipped, refused }  (zero GitHub calls)
//
// playbooks-1: re-roll an edited playbook to the repos still on an older version. The apply routes
// refuse an adopter outright (the landed file is on base, and openDraftPr never overwrites a base file);
// this is the one door that may update that file, and these are its bounds:
//   1. ROLE. POST is requireOrgAdmin(org, "admin"): admin, and refused on the shared public org on every
//      deployment. GET is a member read (resolvePlaybookOrg).
//   2. TARGET SET. Every repo must be in THIS playbook's revisable set (behind, or unversioned with a
//      landed digest). Anything else (a hand-edited file, a removed one, a repo that never adopted, a
//      foreign coordinate) is a refused row and gets no PR. The landed path and digest come from the
//      ledger server-side; the caller supplies only repo names.
//   3. THE WRITE. applyPlaybookToRepo in revision mode: the ledger's landed path (a renamed playbook is
//      updated in place, never seeded a second time), and openDraftPr replaces the file ONLY when its
//      base bytes still hash to the landed digest, with the verified blob sha on the PUT. A file edited
//      in the repo since it landed is refused, never overwritten. Every PR is a DRAFT.
//   4. CAP. MAX_REVISION_BATCH (25), deduped case-insensitively first; over-cap is `skipped`.
//   5. DRY-RUN runs before the App check and the token mint. An archived playbook is a 409.

import { NextResponse } from "next/server";
import { isAppConfigured, AppApiError } from "@/lib/github/app";
import { getOrgId, getPlaybook, getPlaybookOrgSlug, isDbConfigured, recordOrgAudit } from "@/lib/db";
import { readPlaybookRevision } from "@/lib/db/playbook-revision";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { requireOrgAdmin } from "@/lib/authz";
import { archivedPlaybookRefusal, resolvePlaybookOrg } from "@/lib/org/playbook-gate";
import { classifyPrWriteError, requirePrWriteTarget } from "@/lib/github/pr-route";
import { applyPlaybookToRepo } from "@/lib/org/playbook-apply";
import { playbookStarterFile } from "@/lib/org/playbook-brief";
import { MAX_REVISION_BATCH } from "@/lib/org/playbookRevisionModel";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";
import { dimShort } from "@/lib/ui";
import type { BatchResult } from "@/features/shared/practices/practiceApplyShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const NOT_BEHIND =
  "Not on an older version of this playbook with an unedited landed file, so no revision PR was opened.";
const CHANGED = "The landed playbook file was edited in the repo, or removed, so Ascent did not overwrite it.";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gated = await resolvePlaybookOrg(id);
  if (gated instanceof Response) return gated;
  const playbook = await getPlaybook(id);
  if (!playbook) return NextResponse.json({ error: "Playbook not found." }, { status: 404 });
  const orgId = await getOrgId(gated.org);
  if (!orgId) return NextResponse.json({ error: "Playbook not found." }, { status: 404 });
  const { sets } = await readPlaybookRevision(orgId, id, playbook.version);
  return NextResponse.json({ ...sets, archived: playbook.archived === true });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isDbConfigured()) return NextResponse.json({ error: "Playbooks require a database." }, { status: 503 });
  const actorLogin = await resolveViewerLogin();
  if ((authGateEnabled() || isAuthConfigured()) && !actorLogin) {
    return NextResponse.json({ error: "Sign in to open revision PRs." }, { status: 401 });
  }
  const org = await getPlaybookOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Playbook not found." }, { status: 404 });
  const denied = await requireOrgAdmin(org, "admin");
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { repos?: unknown; base?: string; dryRun?: boolean };
  const requested = Array.isArray(body.repos) ? body.repos.filter((r): r is string => typeof r === "string" && r.trim() !== "") : [];
  if (requested.length === 0) {
    return NextResponse.json({ error: "Provide { repos: ['owner/name', ...] }." }, { status: 400 });
  }

  const playbook = await getPlaybook(id);
  const refusedPlaybook = archivedPlaybookRefusal(playbook);
  if (refusedPlaybook || !playbook) return refusedPlaybook ?? NextResponse.json({ error: "Playbook not found." }, { status: 404 });
  const orgId = await getOrgId(org);
  if (!orgId) return NextResponse.json({ error: "Playbook not found." }, { status: 404 });

  // Bound #2: only the playbook's own revisable set, keyed case-insensitively; dedupe before the cap.
  const { targets } = await readPlaybookRevision(orgId, id, playbook.version);
  const byKey = new Map(targets.map((t) => [t.repo.toLowerCase(), t]));
  const seen = new Set<string>();
  const eligible: typeof targets = [];
  const refused: BatchResult[] = [];
  for (const raw of requested) {
    const key = raw.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const t = byKey.get(key);
    if (t) eligible.push(t);
    else refused.push({ repo: raw.trim(), ok: false, error: NOT_BEHIND });
  }
  const batch = eligible.slice(0, MAX_REVISION_BATCH);
  const skipped = eligible.length - batch.length;
  const fromVersions = Object.fromEntries(batch.map((t) => [t.repo, t.appliedVersion]));

  if (body.dryRun === true) {
    return NextResponse.json({
      repos: batch.map((t) => t.repo),
      fromVersions,
      toVersion: playbook.version,
      starter: playbookStarterFile(playbook, dimShort(playbook.dimId)),
      skipped,
      refused: refused.map((r) => r.repo),
    });
  }
  if (batch.length === 0) return NextResponse.json({ results: refused, attempted: 0, skipped });

  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "Opening PRs needs the GitHub App installed with contents + pull-request write access." },
      { status: 503 },
    );
  }

  try {
    const door = await requirePrWriteTarget(org, batch.map((t) => t.repo), "tracked");
    if (door instanceof Response) return door;
    const byRepo = new Map(batch.map((t) => [t.repo.toLowerCase(), t]));
    const results = await mapPool<(typeof door.targets)[number], BatchResult>(door.targets, SCAN_CONCURRENCY, async (p) => {
      const t = byRepo.get(p.fullName.toLowerCase());
      if (!t) return { repo: p.fullName, ok: false, error: NOT_BEHIND };
      try {
        const { pr, fullName } = await applyPlaybookToRepo({
          token: p.token,
          org,
          playbook,
          parsed: p,
          base: body.base,
          actorLogin,
          batch: true,
          revision: { artifactPath: t.artifactPath, baseDigest: t.adoptedHash },
        });
        return { repo: fullName, ok: true, url: pr.url, reused: pr.reused };
      } catch (err) {
        const classified = classifyPrWriteError(err, { conflict: () => CHANGED });
        return { repo: p.fullName, ok: false, error: classified?.message ?? "Failed to open the revision PR." };
      }
    });

    const versions = batch.map((t) => t.appliedVersion).filter((v): v is number => v !== null);
    try {
      await recordOrgAudit(
        "playbook.revision_opened",
        org,
        {
          playbookId: id,
          toVersion: playbook.version,
          fromVersion: versions.length > 0 ? Math.min(...versions) : null,
          repos: results.filter((r) => r.ok).map((r) => r.repo),
          attempted: batch.length,
          skipped,
          refused: refused.length,
        },
        actorLogin ?? undefined,
      );
    } catch (auditErr) {
      // The PRs exist; a failed audit must not read as "not opened" and invite a duplicate run.
      console.error("[playbooks/revise] PRs opened but the audit row failed", auditErr instanceof Error ? auditErr.message : auditErr);
    }
    return NextResponse.json({ results: [...results, ...refused], attempted: batch.length, skipped });
  } catch (err) {
    if (err instanceof AppApiError) {
      return NextResponse.json({ error: "Failed to mint an installation token for this org." }, { status: 502 });
    }
    console.error("[playbooks/revise] failed", err);
    return NextResponse.json({ error: "Failed to open the revision PRs." }, { status: 500 });
  }
}
