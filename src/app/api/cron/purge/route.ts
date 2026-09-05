// GET /api/cron/purge — scheduled data-retention purge. Invoked by Vercel Cron (see vercel.json).
// Enforces each org's retention policy (keep the newest N scans per repo + their dimensions and
// recommendations; drop audit entries older than X days), deleting in small DSQL-safe batches,
// and records its own audit entry. Guarded by CRON_SECRET when set. Requires DATABASE_URL.
//
// Retention is opt-in: with no RETENTION_* env vars and no per-org override set, every window is
// 0 and this is a no-op. See src/lib/db/retention.ts and docs/features/fleet/enterprise.md.

import { NextResponse } from "next/server";
import { isDbConfigured, purgeExpiredData } from "@/lib/db";
import { requireCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// COUPLED CONSTANT (data-retention 07-16 #1): this literal MUST equal PURGE_MAX_DURATION_S in
// src/lib/db/retention.ts — the purge's soft time budget is derived from it (cap − headroom) so the
// run stops cleanly with a summary before the platform hard-kills the function. Next.js requires this
// segment config to be a statically-analyzable literal, so it cannot import the constant; route.test.ts
// pins the equality instead. Plan caveat: the platform honors 300s only up to the deployment plan's
// function cap — on a lower-capped plan set RETENTION_TIME_BUDGET_MS below the REAL cap.
export const maxDuration = 300;

export async function GET(request: Request) {
  // Fail-closed CRON_SECRET gate (503 when unset/empty, 401 on a bad credential), header-only and
  // compared in constant time. This route hand-rolled that check because the shared helper used to be
  // WEAKER (it accepted `?key=` and compared with `!==`); G8-48 promoted the strict contract into
  // requireCronAuth, so the destructive purge and the other cron handlers can no longer drift apart.
  // The `?key=` channel remains refused by default — query strings are routinely captured by
  // access/CDN/proxy logs, browser history and Referer headers, so a secret there could authorize a
  // DELETE-everything run from places the Authorization header never reaches.
  const denied = requireCronAuth(request);
  if (denied) return denied;
  if (!isDbConfigured()) {
    // A DB-unconfigured deploy must NOT report a green 200 (data-retention 07-16 #4): the handler's own
    // invariant is "degraded is never green" (207/500 below) because cron monitors only watch the HTTP
    // status — yet a production deploy that loses/renames DATABASE_URL would keep returning 200 daily
    // while every retention window silently stops being enforced. Fail closed with 503, matching the
    // CRON_SECRET-unset branch (the same "misconfigured deploy" class). A GENUINELY DB-less deployment
    // (the keyless MVP, where a scheduled purge is a deliberate no-op) opts into the quiet green skip
    // explicitly via RETENTION_ALLOW_NO_DB=1.
    if (process.env.RETENTION_ALLOW_NO_DB === "1") {
      return NextResponse.json({ skipped: "Database required." });
    }
    return NextResponse.json(
      { error: "Database is not configured (DATABASE_URL unset). Set RETENTION_ALLOW_NO_DB=1 for an intentionally DB-less deployment." },
      { status: 503 },
    );
  }

  // Preview mode (data-retention 07-16 #2): `?dryRun=1` (or `true`) counts what every effective policy
  // WOULD delete — per-repo stale-scan totals + in-window audit rows — without deleting anything or
  // writing audit entries. Use it to validate a new per-org override before the next real tick applies
  // it; the summary carries `dryRun: true` so a preview can never be mistaken for an enforcement run.
  const dryRunParam = new URL(request.url).searchParams.get("dryRun")?.toLowerCase() ?? "";
  const dryRun = dryRunParam === "1" || dryRunParam === "true";

  try {
    const summary = await purgeExpiredData({ dryRun });
    // A DEGRADED run must NOT report a green 200: Vercel Cron and uptime monitors only watch the HTTP
    // status, so a non-2xx is the only thing that pages an operator. Two channels signal degradation and
    // BOTH must trip the 207 — `errors` (a per-org prune threw, or a destructive purge lost its compliance
    // audit trace) AND `stoppedEarly` (the wall-clock budget stopped the run before every org/sweep was
    // reached). Gating on errors alone regressed the route's own invariant: the trailing orphan-audit and
    // public-scan-quota sweeps set stoppedEarly but push NO error when the budget skips them (data-retention
    // #2), so a run that silently skipped its sweeps returned 200. Widening the decision here (rather than
    // scattering `(budget):` error strings across every skip branch) wires that second channel in one
    // place. A TOTAL failure still 500s (catch).
    if (summary && (summary.errors.length > 0 || summary.stoppedEarly)) {
      console.warn("[cron/purge] completed degraded", {
        errors: summary.errors,
        stoppedEarly: summary.stoppedEarly,
        orgsRemaining: summary.orgsRemaining,
      });
      // Return 207 (Multi-Status) with the FULL summary in the body — the deletes that did succeed are
      // still reported, but the run is visibly not-OK.
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
