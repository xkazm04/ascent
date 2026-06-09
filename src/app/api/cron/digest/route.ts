// GET /api/cron/digest — weekly fleet digest. Invoked by Vercel Cron (see vercel.json). For each org
// with watched repos, summarize the past week (rollup + top movers + the highest-leverage gap) and
// POST a Block-Kit message to ALERT_WEBHOOK_URL. Where regression alerts fire per-repo on a slide,
// this is the positive periodic push that keeps a leader engaged without opening the app.
//
// Guarded by CRON_SECRET when set. No-op without a DB or without an alert sink configured.

import { NextResponse } from "next/server";
import {
  getOrgBenchmark,
  getOrgMovers,
  getOrgRecommendations,
  getOrgRollup,
  isDbConfigured,
  listOrgsWithWatchedRepos,
} from "@/lib/db";
import { buildFleetDigestMessage, dispatchAlert, isAlertConfigured } from "@/lib/alerts";
import { levelForScore } from "@/lib/maturity/model";
import { forecastHeadline } from "@/lib/maturity/forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // Fail closed: a missing/empty CRON_SECRET must NOT leave this endpoint open. The check was
    // opt-in (`if (secret)`), so a forgotten env var on a new deploy silently disabled auth on a
    // route that pushes fleet data to an external alert sink. Refuse rather than run unauthed.
    return NextResponse.json({ error: "Cron is not configured (CRON_SECRET unset)." }, { status: 503 });
  }
  const auth = request.headers.get("authorization");
  const key = new URL(request.url).searchParams.get("key");
  if (auth !== `Bearer ${secret}` && key !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDbConfigured()) return NextResponse.json({ skipped: "Database required." });
  if (!isAlertConfigured()) return NextResponse.json({ skipped: "No ALERT_WEBHOOK_URL configured." });

  const base = (process.env.ASCENT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const orgs = await listOrgsWithWatchedRepos();
  const win = { start: new Date(Date.now() - 7 * 86_400_000), end: null };

  let sent = 0;
  const errors: string[] = [];
  for (const org of orgs) {
    try {
      const rollup = await getOrgRollup(org, win);
      if (!rollup || rollup.scannedCount === 0) continue; // nothing to report on yet
      const [movers, recs, benchmark] = await Promise.all([
        getOrgMovers(org, win).catch(() => null),
        getOrgRecommendations(org, 1).catch(() => null),
        getOrgBenchmark(org).catch(() => null),
      ]);
      const level = levelForScore(rollup.avgOverall);
      const top = recs?.[0];
      const msg = buildFleetDigestMessage({
        org,
        // Link straight to the exec briefing — the digest is its push-channel summary.
        url: base ? `${base}/org/${encodeURIComponent(org)}/executive` : undefined,
        repoCount: rollup.repoCount,
        scannedCount: rollup.scannedCount,
        avgOverall: rollup.avgOverall,
        level: `${level.id} · ${level.name}`,
        overallDelta: rollup.deltas?.overall ?? null,
        gainers: (movers?.gainers ?? []).slice(0, 3).map((m) => ({ name: m.name, delta: m.dOverall })),
        regressers: (movers?.regressers ?? []).slice(0, 3).map((m) => ({ name: m.name, delta: m.dOverall })),
        topRecommendation: top ? { title: top.title, repoCount: top.repoCount } : null,
        percentile: benchmark?.overallPercentile ?? null,
        trajectory: rollup.forecast ? forecastHeadline(rollup.forecast) : null,
      });
      if (await dispatchAlert(msg)) sent += 1;
    } catch (err) {
      errors.push(`${org}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  return NextResponse.json({ orgs: orgs.length, sent, errors });
}
