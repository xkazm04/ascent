// GET /api/cron/rescan — scheduled autoscans. Invoked by Vercel Cron (see vercel.json).
// Scans every repo whose autoscan is due (per-repo nextScanAt), persists, and advances
// the schedule. Guarded by CRON_SECRET when set.
//
// Note: runs on the deployment, so it uses the configured LLM_PROVIDER (gemini/bedrock —
// claude-cli is local-only). Requires the GitHub App + DATABASE_URL.

import { NextResponse } from "next/server";
import { scanRepository } from "@/lib/scan";
import {
  advanceSchedule,
  advanceScheduleAfterFailure,
  getInstallationIdForOwner,
  getOrgId,
  getScanReportByCommit,
  isDbConfigured,
  listDueRescans,
  persistScanReport,
  recordScanOutcome,
} from "@/lib/db";
import { checkAndAlertRegression } from "@/lib/scan-alerts";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    const key = new URL(request.url).searchParams.get("key");
    if (auth !== `Bearer ${secret}` && key !== secret) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }
  if (!isAppConfigured() || !isDbConfigured()) {
    return NextResponse.json({ skipped: "GitHub App + database required." });
  }

  const due = await listDueRescans();

  // Pre-resolve one installation token per distinct org up front: concurrent lanes would otherwise
  // race to mint the same org's token. One mint per org, reused by every lane scanning it.
  const orgSlugs = [...new Set(due.map((r) => r.orgSlug))];
  const tokenByOrg = new Map<string, string | undefined>();
  await Promise.all(
    orgSlugs.map(async (slug) => {
      const id = await getInstallationIdForOwner(slug).catch(() => null);
      tokenByOrg.set(slug, id ? await getInstallationToken(id).catch(() => undefined) : undefined);
    }),
  );

  let scanned = 0;
  const errors: string[] = [];

  // Scan with bounded concurrency so a real fleet drains within the 300s budget (counters mutate in
  // single-threaded lanes — race-free).
  await mapPool(due, SCAN_CONCURRENCY, async (r) => {
    try {
      const token = tokenByOrg.get(r.orgSlug);
      // Capture the prior persisted report BEFORE the new scan lands, so we can diff for a
      // regression alert once the fresh scan is stored.
      const [owner, name] = r.fullName.split("/");
      const prev = await getScanReportByCommit(owner, name, { orgSlug: r.orgSlug }).catch(() => null);

      const report = await scanRepository(r.fullName, { token });
      const persisted = await persistScanReport(report, { orgSlug: r.orgSlug });
      if (persisted && (persisted.failures.audit || persisted.failures.contributors > 0)) {
        console.warn("[cron/rescan] persisted with partial write failures", {
          repo: r.fullName,
          scanId: persisted.scanId,
          failures: persisted.failures,
        });
      }
      // Live intelligence: alert on a regression vs the prior scan (skipped on an unchanged commit).
      if (persisted && !persisted.deduped) {
        const orgId = (await getOrgId(r.orgSlug).catch(() => null)) ?? undefined;
        await checkAndAlertRegression(prev, report, { orgId });
      }
      await advanceSchedule(r.repoId, r.scanSchedule);
      await recordScanOutcome(r.orgSlug, r.fullName, { ok: true }).catch(() => {});
      scanned += 1;
    } catch (err) {
      // ALWAYS advance, even on failure (with a backoff). The schedule used to advance only on
      // success, so a persistently-broken repo stayed permanently due at the front of the queue and
      // re-failed every run, starving the rest of the fleet. Back it off so it leaves the front.
      await advanceScheduleAfterFailure(r.repoId).catch(() => {});
      // Persist the failure so the dashboard can flag this repo as broken (not "never scanned").
      await recordScanOutcome(r.orgSlug, r.fullName, {
        ok: false,
        error: err instanceof Error ? err.message : "scan failed",
      }).catch(() => {});
      errors.push(`${r.fullName}: ${err instanceof Error ? err.message : "failed"}`);
    }
  });

  return NextResponse.json({ due: due.length, scanned, errors });
}
