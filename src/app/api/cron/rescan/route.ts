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
  getInstallationIdForOwner,
  getOrgId,
  getScanReportByCommit,
  isDbConfigured,
  listDueRescans,
  persistScanReport,
} from "@/lib/db";
import { checkAndAlertRegression } from "@/lib/scan-alerts";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";

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
  const tokenCache = new Map<string, string | undefined>();
  let scanned = 0;
  const errors: string[] = [];

  for (const r of due) {
    try {
      if (!tokenCache.has(r.orgSlug)) {
        const id = await getInstallationIdForOwner(r.orgSlug);
        tokenCache.set(r.orgSlug, id ? await getInstallationToken(id).catch(() => undefined) : undefined);
      }
      const token = tokenCache.get(r.orgSlug);
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
      scanned += 1;
    } catch (err) {
      errors.push(`${r.fullName}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  return NextResponse.json({ due: due.length, scanned, errors });
}
