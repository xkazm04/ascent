// GET /api/cron/rescan — scheduled autoscans. Invoked by Vercel Cron (see vercel.json).
//
// SINCE moonshot #10 this route is a SEEDER plus a WORKER over the durable `ScanJob` queue, not a
// self-contained scan loop:
//
//   reapExpiredLeases() → enqueueDueRescans() → drainLane("rescore") until the deadline.
//
// What that buys, and why it was worth changing a working route:
//   • The 100-repo-per-pass cap is GONE. The seeder enqueues everything due; the drain takes what
//     fits in 300s. A 900-repo org seeds in one pass and drains across several, instead of having
//     800 repos silently wait for tomorrow.
//   • Truncation stops being a data-loss event. The remainder is a queued ROW, so the next pass (or
//     another instance running concurrently) finishes exactly it.
//   • The claim moved from `nextScanAt` (which is also the schedule, so the lock corrupted the thing
//     it locked) to a job row. `claimRescan` still exists and still means what it did; this lane's
//     dedup is now the queue's conditional claim.
//
// Every money rule is unchanged and now lives in one place (`src/lib/scan-queue-worker.ts`): reserve
// before inference, refund a PRE-inference failure only, keep the credit on a post-inference one and
// say so. See docs/features/fleet/rescan.md.
//
// Note: runs on the deployment, so it uses the configured LLM_PROVIDER (gemini/bedrock —
// claude-cli is local-only). Requires the GitHub App + DATABASE_URL. The free control-probe lane is
// a separate route (/api/cron/probe) with its own budget and cadence.

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
// MC-B14: the control ledger's daily sealing pass rides this cron. Deep path, not the barrel.
import { sealAllPendingDays } from "@/lib/db/control-observations";
// Deep path, not the barrel: `db/index.ts` is Director-owned and its two queue re-export lines land
// at merge. Nothing else about these imports changes when they do.
import { enqueueDueRescans, queueDepth, reapExpiredLeases } from "@/lib/db/scan-jobs";
import { requireCronAuth } from "@/lib/cron-auth";
import { isAppConfigured } from "@/lib/github/app";
import { drainLane } from "@/lib/scan-queue-worker";
import { fleetDeadlineAt, SCAN_CONCURRENCY } from "@/lib/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  // Anchor the budget at invocation start so the drain can stop issuing new work and RETURN a result,
  // instead of being process-killed with no response body.
  const invokedAt = Date.now();
  // Fail-closed CRON_SECRET gate (503 when unset, 401 on a bad credential), single-sourced so this
  // route that mints every org's token and spends LLM budget can't drift from the other cron handlers.
  const denied = requireCronAuth(request);
  if (denied) return denied;
  if (!isDbConfigured()) {
    return NextResponse.json({ skipped: "GitHub App + database required." });
  }

  // MOONSHOT #1 / MC-B14 — SEAL THE CONTROL LEDGER FIRST, before anything else this route does.
  //
  // It runs here rather than inside `/api/audit/verify` because sealing was a side effect of a READ:
  // an org nobody verified accumulated unsealed days until retention aged the rows out, and a day
  // purged before it was ever sealed leaves no seal behind — the deletion becomes undetectable,
  // which is the one thing the seal exists to prevent. Placed BEFORE the App check on purpose: a
  // deployment without the GitHub App still holds a ledger written by scans, and its evidence must
  // not stop being sealed because the App is not installed. Best-effort — a sealing failure can
  // never fail the rescan pass.
  //
  // ORDERING AGAINST THE PURGE, stated because it is load-bearing: `/api/cron/purge` runs at 04:00
  // and this route at 06:00 (vercel.json), so on any given day the purge runs BEFORE the seal. That
  // is safe only because the purge deletes on the org's `auditDays` horizon (floored at
  // RETENTION_MIN_AUDIT_DAYS), which is many days wide, while this pass is at most one day behind —
  // so a day is sealed long before it becomes purge-eligible. The condition that breaks it is a
  // sealing BACKLOG deeper than the retention horizon; `sealBacklogRemaining` is reported below and
  // by /api/audit/verify so it is observable rather than silent. See docs/features/data/retention.md.
  const ledgerSeal = await sealAllPendingDays().catch(() => null);

  if (!isAppConfigured()) {
    return NextResponse.json({ skipped: "GitHub App + database required.", ledgerSeal });
  }

  // Reap first: a pass killed at the 300s ceiling leaves claimed rows behind, and a worker that never
  // came back must not strand its repo. Past MAX_JOB_ATTEMPTS the row fails rather than looping.
  const reaped = await reapExpiredLeases().catch(() => 0);
  // Seed everything due. Idempotent per (org, repo, lane, ISO date), so a second pass on the same day
  // — or an overlapping invocation — adds nothing.
  const seeded = await enqueueDueRescans().catch(() => 0);

  const summary = await drainLane("rescore", {
    concurrency: SCAN_CONCURRENCY,
    deadlineAt: fleetDeadlineAt(invokedAt, maxDuration),
  });

  // The honest remainder is the queue's own depth, read AFTER the drain — not a count this invocation
  // guesses at. A lane that stays deep across passes is an oversubscribed schedule, and this JSON body
  // is the only place a cron run can say so.
  const depth = await queueDepth().catch(() => null);
  if (summary.truncated) {
    console.warn(
      `[cron/rescan] time budget reached — ${summary.done} scanned this pass, ${depth?.rescore.queued ?? "?"} still queued for the next`,
    );
  }
  return NextResponse.json({
    ledgerSeal,
    reaped,
    seeded,
    claimed: summary.claimed,
    scanned: summary.done,
    failed: summary.failed,
    skippedForCredits: summary.skippedForCredits,
    skippedNoToken: summary.skippedNoToken,
    skippedAlreadyClaimed: summary.skipped,
    truncated: summary.truncated,
    queueDepth: depth?.rescore ?? null,
    errors: summary.errors,
  });
}
