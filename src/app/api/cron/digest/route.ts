// GET /api/cron/digest — weekly fleet digest. Invoked by Vercel Cron (see vercel.json). For each org
// with watched repos, summarize the past week (rollup + top movers + the highest-leverage gap) and
// POST a Block-Kit message to the org's own webhook (Organization.alertWebhookUrl) when set, falling
// back to the global ALERT_WEBHOOK_URL. Where regression alerts fire per-repo on a slide, this is the
// positive periodic push that keeps a leader engaged without opening the app — routed per tenant so
// each customer receives its own fleet intelligence rather than everything landing in the operator's
// channel. Orgs with no resolvable sink are skipped (counted in the response), so a deployment with
// neither configured is a clean no-op.
//
// Guarded by CRON_SECRET when set. No-op without a DB.

import { NextResponse } from "next/server";
import {
  getCreditState,
  getOrgAlertWebhook,
  getOrgBenchmark,
  getOrgMovers,
  getOrgRecommendations,
  getOrgRollup,
  isDbConfigured,
  listOrgsWithWatchedRepos,
  type OrgWindow,
} from "@/lib/db";
import { buildFleetDigestMessage, creditsAlertThreshold, digestHasSignal, dispatchAlert, isAlertConfigured } from "@/lib/alerts";
import { mapPool } from "@/lib/pool";
import { PUBLIC_ORG } from "@/lib/auth";
import { isWithinNoise } from "@/lib/maturity/noise";
import { levelForScore } from "@/lib/maturity/model";
import { forecastHeadline } from "@/lib/maturity/forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Dispatch orgs with bounded concurrency (not strictly serially) so one slow tenant's rollup work +
// webhook POST can't starve every org behind it. `dispatchAlert` itself is deadline-bounded, so a hung
// sink can't wedge a lane.
const DIGEST_CONCURRENCY = 4;
// Soft deadline under maxDuration (300s): past this, lanes stop starting new orgs and count them as
// `remaining`, so a truncated run is OBSERVABLE in the response rather than silently dropping its tail
// when the platform kills the function.
const SOFT_DEADLINE_MS = 270_000;

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

  const base = (process.env.ASCENT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  const orgs = await listOrgsWithWatchedRepos();
  const win: OrgWindow = { start: new Date(Date.now() - 7 * 86_400_000), end: null };

  let sent = 0;
  let failed = 0;
  let skippedNoSink = 0;
  let skippedFlat = 0;
  let remaining = 0;
  const errors: string[] = [];
  const startedAt = Date.now();
  await mapPool(orgs, DIGEST_CONCURRENCY, async (org) => {
    // Time budget exhausted — stop starting new orgs and count the untouched tail. Each org round-trips
    // the DB several times (rollup + movers + recs + benchmark + credit), so a large fleet can outrun
    // the function ceiling; surfacing `remaining` makes a truncated run visible instead of silent.
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      remaining += 1;
      return;
    }
    try {
      // Per-tenant routing: the org's own webhook wins; the global env is the single-tenant
      // fallback. No sink resolvable for this org → skip before doing any rollup work (the old
      // global-only early return would have silenced EVERY tenant when the env was unset).
      const webhookUrl = await getOrgAlertWebhook(org).catch(() => null);
      if (!isAlertConfigured(webhookUrl)) {
        skippedNoSink += 1;
        return;
      }
      const rollup = await getOrgRollup(org, win);
      if (!rollup || rollup.scannedCount === 0) return; // nothing to report on yet
      const [movers, recs, benchmark, credit] = await Promise.all([
        getOrgMovers(org, win).catch(() => null),
        getOrgRecommendations(org, 1).catch(() => null),
        getOrgBenchmark(org).catch(() => null),
        // Credit runway for the digest's "top up" line — public org is free/unmetered, skip it.
        org === PUBLIC_ORG ? Promise.resolve(null) : getCreditState(org).catch(() => null),
      ]);
      // Movement-gate: a leader relies on this push instead of opening the app, so a flat week stays
      // silent rather than training the inbox filter. Skip unless something material moved (or credits
      // are running low — always worth the heads-up).
      const creditLow = !!(credit && !credit.unlimited && credit.balance <= creditsAlertThreshold() * 2);
      // ALERTS #1: noise-filter regressers SYMMETRICALLY with gainers below. `regressers` partitions
      // purely on sign, so a pure-jitter week (every repo within ±noise, a couple landing net-negative)
      // would count as "regressions > 0" and fire a misleading digest — defeating the silence-on-noise
      // contract. Compute the beyond-noise set ONCE so the signal gate and the rendered list (below)
      // can't drift out of lockstep.
      const regressersBeyondNoise = (movers?.regressers ?? []).filter((m) => !isWithinNoise(m.dOverall));
      const hasSignal = digestHasSignal({
        overallDelta: rollup.deltas?.overall ?? null,
        levelChanges: movers?.levelChanges?.filter((m) => m.levelDelta !== 0).length ?? 0,
        regressions: regressersBeyondNoise.length,
        gainersBeyondNoise: (movers?.gainers ?? []).filter((m) => !isWithinNoise(m.dOverall)).length,
        creditLow,
      });
      if (!hasSignal) {
        skippedFlat += 1;
        return;
      }
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
        // ALERTS #1: render only regressers beyond noise (the same set the signal gate counted above),
        // so a within-noise −1/−2 repo is never listed under "Regressions:" (which would train the inbox
        // filter the gate exists to avoid).
        regressers: regressersBeyondNoise.slice(0, 3).map((m) => ({ name: m.name, delta: m.dOverall })),
        topRecommendation: top ? { title: top.title, repoCount: top.repoCount } : null,
        percentile: benchmark?.overallPercentile ?? null,
        trajectory: rollup.forecast ? forecastHeadline(rollup.forecast) : null,
        // Carry the balance only when the org is metered and running low (the same condition the
        // movement-gate treats as always-worth-sending) — the digest is the one push a leader reliably
        // reads, so a depleting balance gets a standing line there, not just the crossing alert.
        creditsRemaining: creditLow && credit ? credit.balance : null,
      });
      if (await dispatchAlert(msg, { webhookUrl })) sent += 1;
      else failed += 1; // sink unresolvable at send time, non-2xx, or the deadline aborted the POST
    } catch (err) {
      errors.push(`${org}: ${err instanceof Error ? err.message : "failed"}`);
    }
  });

  return NextResponse.json({ orgs: orgs.length, sent, failed, skippedNoSink, skippedFlat, remaining, errors });
}
