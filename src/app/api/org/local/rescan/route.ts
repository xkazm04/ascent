// LOCAL MODE rescan — score one paired repo from its working copy on disk (self-hosted only).
//
// POST { org, fullName } → resolve the pairing, re-verify the folder (it may have moved since it was
// saved), run the full scan pipeline with LocalFsSource injected, persist under the org. The commits
// `git log` reads are LOCAL — an `Ascent-Resolves:` trailer closes its follow-up here, before any
// push, which is the whole reason this route exists: the ledger's resolve→verify loop collapses from
// "push and wait for the next GitHub scan" to one immediate round trip.
//
// No credit ceremony: this route exists only behind selfHostGuard, where isMeteredScan() is false by
// construction — there is no allowance to count and no credit to reserve, so mirroring the fleet
// route's reserve/refund choreography here would be dead code wearing a billing costume.
//
// maxDuration mirrors /api/org/scan: irrelevant under `next start` (no serverless ceiling) but kept
// so the route stays deployable anywhere the codebase is.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import { selfHostGuard } from "@/lib/api/self-host";
import { verifyLocalPath } from "@/lib/local/pairing";
import { LocalFsSource, isWorkingCopyDirty } from "@/lib/local/source";
import { scanRepository } from "@/lib/scan";
import { getRepoLocalPath, persistScanReport, recordScanOutcome } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const guard = selfHostGuard() ?? dbGuard("Local rescan", "Local rescans require a database.");
  if (guard) return guard;

  const body = (await request.json().catch(() => ({}))) as { org?: unknown; fullName?: unknown };
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";
  if (!org || !fullName) return NextResponse.json({ error: "Missing 'org' or 'fullName'." }, { status: 400 });
  if (org === PUBLIC_ORG) return NextResponse.json({ error: "The public funnel org has no pairings." }, { status: 403 });

  // Member access suffices, like the fleet scan: running a scan reads the paired folder but changes
  // nothing in it. Only PAIRING (which decides what may be read) is owner-gated.
  const denied = await requireOrgAccess(org);
  if (denied) return denied;

  const path = await getRepoLocalPath(org, fullName);
  if (!path) {
    return NextResponse.json({ error: `${fullName} is not paired with a local path — pair it on Admin → Pairing.` }, { status: 409 });
  }
  const check = await verifyLocalPath(path, fullName);
  if (!check.ok) {
    return NextResponse.json({ error: `Pairing broken: ${check.error} (${path})` }, { status: 422 });
  }

  const dirty = await isWorkingCopyDirty(path);
  try {
    const report = await scanRepository(fullName, {
      orgSlug: org,
      source: new LocalFsSource(path),
      // The report must SAY it read from disk — a local scan lacks the GitHub-side signals (PR stats,
      // governance) a cloud scan of the same commit folds in, so the two can score a few points apart
      // and the reader deserves the why on the report itself, not in a doc.
      scopeCaveat: dirty
        ? "Scanned from the local working copy, including uncommitted changes — no commit identity is claimed, and GitHub-side signals (PRs, branch governance) are not included."
        : "Scanned from the local working copy at its current commit — GitHub-side signals (PRs, branch governance) are not included.",
      // Never send a paired working copy's contents through GitHub-token'd enrichment lookups keyed
      // by a name that may not even exist publicly.
      noAmbientToken: true,
    });
    const persisted = await persistScanReport(report, { orgSlug: org });
    await recordScanOutcome(org, fullName, { ok: true }).catch(() => {});
    return NextResponse.json({
      ok: true,
      dirty,
      level: report.level.id,
      overall: report.overallScore,
      headSha: report.repo.headSha ?? null,
      resolvedFollowUps: report.resolvedFollowUpIds ?? [],
      deduped: persisted?.deduped ?? false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Local scan failed.";
    await recordScanOutcome(org, fullName, { ok: false, error: msg }).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
