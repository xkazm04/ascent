// GET /api/cron/purge — scheduled data-retention purge. Invoked by Vercel Cron (see vercel.json).
// Enforces each org's retention policy (keep the newest N scans per repo + their dimensions and
// recommendations; drop audit entries older than X days), deleting in small DSQL-safe batches,
// and records its own audit entry. Guarded by CRON_SECRET when set. Requires DATABASE_URL.
//
// Retention is opt-in: with no RETENTION_* env vars and no per-org override set, every window is
// 0 and this is a no-op. See src/lib/db/retention.ts and docs/ENTERPRISE.md.

import { NextResponse } from "next/server";
import { isDbConfigured, purgeExpiredData } from "@/lib/db";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  // Fail-closed CRON_SECRET gate (503 when unset, 401 on a bad credential), single-sourced so this
  // DELETE-everything retention route can't drift from the other cron handlers. See @/lib/cron-auth.
  const denied = requireCronAuth(request);
  if (denied) return denied;
  if (!isDbConfigured()) {
    return NextResponse.json({ skipped: "Database required." });
  }

  try {
    const summary = await purgeExpiredData();
    if (summary && summary.errors.length > 0) {
      console.warn("[cron/purge] completed with errors", { errors: summary.errors });
    }
    return NextResponse.json(summary ?? { skipped: "Database required." });
  } catch (err) {
    console.error("[cron/purge] failed", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Purge failed." },
      { status: 500 },
    );
  }
}
