// GET /api/cron/purge — scheduled data-retention purge. Invoked by Vercel Cron (see vercel.json).
// Enforces each org's retention policy (keep the newest N scans per repo + their dimensions and
// recommendations; drop audit entries older than X days), deleting in small DSQL-safe batches,
// and records its own audit entry. Guarded by CRON_SECRET when set. Requires DATABASE_URL.
//
// Retention is opt-in: with no RETENTION_* env vars and no per-org override set, every window is
// 0 and this is a no-op. See src/lib/db/retention.ts and docs/ENTERPRISE.md.

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { isDbConfigured, purgeExpiredData } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Constant-time compare for the cron secret. A length mismatch returns false WITHOUT calling
 * timingSafeEqual (which throws on unequal-length buffers) — the length is not the secret. Replaces a
 * plain `!==`, which is a timing oracle on a token that authorizes a DELETE-everything endpoint.
 */
function secretMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: a missing/empty CRON_SECRET must NOT leave this endpoint open. The check was
    // opt-in (`if (secret)`), so a forgotten env var on a new deploy silently disabled auth on a
    // route that DELETES data under the retention policy. Refuse rather than run unauthed.
    return NextResponse.json({ error: "Cron is not configured (CRON_SECRET unset)." }, { status: 503 });
  }
  // Accept ONLY the `Authorization: Bearer` header — the secret must NOT be accepted as a `?key=`
  // query param. Query strings are routinely captured by access/CDN/proxy logs, browser history, and
  // Referer headers, so a secret on that channel can authorize a destructive purge from places the
  // Authorization header never reaches. Compare in constant time (see secretMatches) rather than `!==`.
  const auth = request.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
  if (!presented || !secretMatches(presented, secret)) {
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
