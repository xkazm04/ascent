// GET /api/cron/probe — the FREE control lane (moonshot #10). Drains queued `probe` jobs: each one
// re-reads a repo's deterministic controls straight from the GitHub API and appends what changed to
// the control ledger. No LLM call, no `Scan` row, no credit — so this runs on every plan, including
// Free and self-hosted, and is independent of the deployment's `LLM_PROVIDER`.
//
// A SECOND cron route rather than a `?lane=` on /api/cron/rescan, deliberately: cron auth is
// per-route, the cadences differ (hourly vs daily), and the budgets differ by an order of magnitude
// (60s vs 300s). One route with two personalities would have to take the larger of each.

import { NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { isDbConfigured } from "@/lib/db";
// Deep path, not the barrel: `db/index.ts` is Director-owned, and its two `export *` lines for the
// queue land at merge (see the handoff). Nothing else about this import changes when they do.
import { queueDepth } from "@/lib/db/scan-jobs";
import { isAppConfigured } from "@/lib/github/app";
import { drainLane } from "@/lib/scan-queue-worker";
import { fleetDeadlineAt, PROBE_CONCURRENCY } from "@/lib/pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const invokedAt = Date.now();
  // The same fail-closed gate as every other cron route (503 when CRON_SECRET is unset, 401 on a bad
  // credential) — this one mints installation tokens, so it is credentialed work even though it is free.
  const denied = requireCronAuth(request);
  if (denied) return denied;
  if (!isAppConfigured() || !isDbConfigured()) {
    return NextResponse.json({ skipped: "GitHub App + database required." });
  }

  const summary = await drainLane("probe", {
    concurrency: PROBE_CONCURRENCY,
    deadlineAt: fleetDeadlineAt(invokedAt, maxDuration),
  });

  // Report the depth AFTER the drain: a lane that stays deep across passes is an oversubscribed
  // schedule, and this JSON body is the only place a cron run can say so.
  const depth = await queueDepth().catch(() => null);
  return NextResponse.json({
    lane: "probe",
    claimed: summary.claimed,
    done: summary.done,
    failed: summary.failed,
    skipped: summary.skipped,
    truncated: summary.truncated,
    queueDepth: depth?.probe ?? null,
    errors: summary.errors,
  });
}
