// GET /api/cron/purge — scheduled data-retention purge. Invoked by Vercel Cron (see vercel.json).
// Enforces each org's retention policy (keep the newest N scans per repo + their dimensions and
// recommendations; drop audit entries older than X days), deleting in small DSQL-safe batches,
// and records its own audit entry. Guarded by CRON_SECRET when set. Requires DATABASE_URL.
//
// Retention is opt-in: with no RETENTION_* env vars and no per-org override set, every window is
// 0 and this is a no-op. See src/lib/db/retention.ts and docs/ENTERPRISE.md.

import { NextResponse } from "next/server";
import { isDbConfigured, purgeExpiredData } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: a missing/empty CRON_SECRET must NOT leave this endpoint open. The check was
    // opt-in (`if (secret)`), so a forgotten env var on a new deploy silently disabled auth on a
    // route that DELETES data under the retention policy. Refuse rather than run unauthed.
    return NextResponse.json({ error: "Cron is not configured (CRON_SECRET unset)." }, { status: 503 });
  }
  const auth = request.headers.get("authorization");
  const key = new URL(request.url).searchParams.get("key");
  if (auth !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ skipped: "Database required." });
  }

  try {
    const summary = await purgeExpiredData();
    if (summary && summary.errors.length > 0) {
      console.warn("[cron/purge] completed with errors", { errors: summary.errors });
      // A DEGRADED run (a per-org prune threw, a destructive purge lost its compliance audit trace, or
      // the time budget stopped the loop with orgs unprocessed) must NOT report a green 200: Vercel Cron
      // and uptime monitors only watch the HTTP status, so a non-2xx is the only thing that pages an
      // operator. Return 207 (Multi-Status) with the FULL summary in the body — the deletes that did
      // succeed are still reported, but the run is visibly not-OK. A TOTAL failure still 500s (catch).
      return NextResponse.json(summary, { status: 207 });
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
