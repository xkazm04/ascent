// GET /api/cron/rescan — scheduled autoscans. Invoked by Vercel Cron (see vercel.json).
// Scans every repo whose autoscan is due (per-repo nextScanAt), persists, and advances
// the schedule. Guarded by CRON_SECRET when set.
//
// Note: runs on the deployment, so it uses the configured LLM_PROVIDER (gemini/bedrock —
// claude-cli is local-only). Requires the GitHub App + DATABASE_URL.

import { NextResponse } from "next/server";
import { scanRepository } from "@/lib/scan";
import {
  advanceScheduleAfterFailure,
  claimRescan,
  getInstallationIdForOwner,
  getOrgId,
  getScanReportByCommit,
  isDbConfigured,
  listDueRescans,
  persistScanReport,
  recordScanOutcome,
} from "@/lib/db";
import { requireCronAuth } from "@/lib/cron-auth";
import { checkAndAlertRegression } from "@/lib/scan-alerts";
import { logPartialWrites, refundScanCredit, reserveScanCredit, shouldRefundScan } from "@/lib/scan-credit";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  // Fail-closed CRON_SECRET gate (503 when unset, 401 on a bad credential), single-sourced so this
  // route that mints every org's token and spends LLM budget can't drift from the other cron handlers.
  const denied = requireCronAuth(request);
  if (denied) return denied;
  if (!isAppConfigured() || !isDbConfigured()) {
    return NextResponse.json({ skipped: "GitHub App + database required." });
  }

  const due = await listDueRescans();

  // Pre-resolve one installation token per distinct org up front: concurrent lanes would otherwise
  // race to mint the same org's token. One mint per org, reused by every lane scanning it. Track orgs
  // that HAVE an install id but whose token mint FAILED separately from orgs with no install at all: the
  // former is a likely-revoked/suspended install (every private repo would 404), the latter is a public
  // org whose repos legitimately scan via the tokenless path.
  const orgSlugs = [...new Set(due.map((r) => r.orgSlug))];
  const tokenByOrg = new Map<string, string | undefined>();
  const brokenInstallOrgs = new Set<string>();
  await Promise.all(
    orgSlugs.map(async (slug) => {
      const id = await getInstallationIdForOwner(slug).catch(() => null);
      if (!id) {
        tokenByOrg.set(slug, undefined); // no install — a public org; scans use the tokenless path
        return;
      }
      const tok = await getInstallationToken(id).catch(() => undefined);
      tokenByOrg.set(slug, tok);
      if (!tok) brokenInstallOrgs.add(slug); // had an install but the mint failed → likely revoked
    }),
  );

  let scanned = 0;
  let skippedForCredits = 0;
  let skippedAlreadyClaimed = 0;
  let skippedNoToken = 0;
  const errors: string[] = [];

  // Scan with bounded concurrency so a real fleet drains within the 300s budget (counters mutate in
  // single-threaded lanes — race-free).
  await mapPool(due, SCAN_CONCURRENCY, async (r) => {
    // CLAIM-BEFORE-WORK: atomically take ownership of this due repo before any expensive or billable
    // step. `claimRescan` advances nextScanAt to the next cadence only while the repo is still due, so
    // if an overlapping cron run (long batch near the 300s ceiling, a manual `?key=` retry, or a
    // re-fired schedule) already claimed it, this returns false and we skip — the run-level guard that
    // stops two invocations double-scanning + double-billing the same repo. Cross-instance safe.
    const claimed = await claimRescan(r.repoId, r.scanSchedule).catch(() => false);
    if (!claimed) {
      skippedAlreadyClaimed += 1;
      return;
    }

    // Short-circuit a whole org whose installation token couldn't be minted (likely revoked/suspended):
    // don't reserve a credit, re-mint, or scan with no token (every private repo would 404, refund, and
    // get a 6h failure backoff — so the dead fleet was re-attempted EVERY daily cron pass). The claim
    // above already advanced nextScanAt to the full cadence, so it now waits the cadence, not 6h.
    if (brokenInstallOrgs.has(r.orgSlug)) {
      skippedNoToken += 1;
      await recordScanOutcome(r.orgSlug, r.fullName, { ok: false, error: "installation token unavailable" }).catch(() => {});
      return;
    }

    // Reserve one prepaid credit per autoscan (a private scan = paid). Unlimited plans are a no-op.
    // An org out of credits has this repo skipped; its schedule was already advanced by the claim
    // above, so a credit-less org doesn't jam the front of the queue. Refunded below if the scan fails,
    // degrades to mock, or dedupes to an unchanged commit (no new scored row billed). The reservation
    // also fires the proactive low-credit alert when the debit lands on the low-water mark — the cron
    // drains credits with nobody watching, which is exactly when depletion must reach a human.
    const reservation = await reserveScanCredit(r.orgSlug, r.fullName);
    if (reservation.skip) {
      skippedForCredits += 1;
      return;
    }
    const charged = reservation.reserved; // true only on an overflow credit debit (within-allowance is free)
    const refundCredit = () => refundScanCredit(r.orgSlug, charged);
    try {
      const token = tokenByOrg.get(r.orgSlug);
      // Capture the prior persisted report BEFORE the new scan lands, so we can diff for a
      // regression alert once the fresh scan is stored.
      const [owner = "", name = ""] = r.fullName.split("/");
      const prev = await getScanReportByCommit(owner, name, { orgSlug: r.orgSlug }).catch(() => null);

      const report = await scanRepository(r.fullName, { token });
      const persisted = await persistScanReport(report, { orgSlug: r.orgSlug });
      logPartialWrites("cron/rescan", r.fullName, persisted);
      // Refund the reserved credit when the autoscan produced nothing billable: either it degraded to
      // mock (no real inference) OR the commit was unchanged since the last scan (`deduped` — no new
      // scored row). An org shouldn't be charged for a system-initiated rescan that yielded no new result.
      if (shouldRefundScan(report, persisted)) await refundCredit();
      // Live intelligence: alert on a regression vs the prior scan (skipped on an unchanged commit).
      if (persisted && !persisted.deduped) {
        const orgId = (await getOrgId(r.orgSlug).catch(() => null)) ?? undefined;
        await checkAndAlertRegression(prev, report, { orgId, orgSlug: r.orgSlug });
      }
      // Schedule was already advanced to the full cadence by the claim above — nothing to do here.
      await recordScanOutcome(r.orgSlug, r.fullName, { ok: true }).catch(() => {});
      scanned += 1;
    } catch (err) {
      // The scan failed — no inference to bill, so refund the credit reserved above.
      await refundCredit();
      // Override the claim's full-cadence nextScanAt with a shorter retry backoff, so a transient
      // failure is retried sooner than a full cadence (but still off the front of the oldest-first
      // queue, so a persistently-broken repo can't starve the rest of the fleet).
      await advanceScheduleAfterFailure(r.repoId).catch(() => {});
      // Persist the failure so the dashboard can flag this repo as broken (not "never scanned").
      await recordScanOutcome(r.orgSlug, r.fullName, {
        ok: false,
        error: err instanceof Error ? err.message : "scan failed",
      }).catch(() => {});
      errors.push(`${r.fullName}: ${err instanceof Error ? err.message : "failed"}`);
    }
  });

  return NextResponse.json({ due: due.length, scanned, skippedForCredits, skippedAlreadyClaimed, skippedNoToken, errors });
}
