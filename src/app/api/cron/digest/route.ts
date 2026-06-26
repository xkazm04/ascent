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
  getAuditLog,
  getCreditState,
  getOrgAlertWebhook,
  getOrgBenchmark,
  getOrgMovers,
  getOrgRecommendations,
  getOrgRollup,
  isDbConfigured,
  listOrgsWithWatchedRepos,
  recordOrgAudit,
  type OrgWindow,
} from "@/lib/db";
import { buildFleetDigestMessage, creditsAlertThreshold, digestHasSignal, dispatchAlert, isAlertConfigured } from "@/lib/alerts";
import { PUBLIC_ORG } from "@/lib/auth";
import { isWithinNoise } from "@/lib/maturity/noise";
import { levelForScore } from "@/lib/maturity/model";
import { forecastHeadline } from "@/lib/maturity/forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Audit action stamped after each successful per-org digest send. It doubles as the at-most-once
// idempotency key for the window (skip an org that already has one within the current 7-day window) —
// migration-free, since Organization has no spare last-sent column under the junctioned DB client.
const DIGEST_SENT_ACTION = "org.digest.sent";

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
  const windowStart = new Date(Date.now() - 7 * 86_400_000);
  const win: OrgWindow = { start: windowStart, end: null };

  let sent = 0;
  let skippedNoSink = 0;
  let skippedFlat = 0;
  let skippedAlreadySent = 0;
  const errors: string[] = [];
  for (const org of orgs) {
    try {
      // Per-tenant routing: the org's own webhook wins; the global env is the single-tenant
      // fallback. No sink resolvable for this org → skip before doing any rollup work (the old
      // global-only early return would have silenced EVERY tenant when the env was unset).
      const webhookUrl = await getOrgAlertWebhook(org).catch(() => null);
      if (!isAlertConfigured(webhookUrl)) {
        skippedNoSink += 1;
        continue;
      }
      // At-most-once per window: this handler loops every org under maxDuration and can time out
      // partway, be retried by the platform, or overlap a re-fired schedule. Without a last-sent guard
      // every already-notified org would receive the weekly digest AGAIN (eroding the exact push channel
      // the feature makes habit-forming). Skip an org that already got a digest within this window —
      // recorded as an audit entry after each successful dispatch below.
      const alreadySent = await getAuditLog(org, { action: DIGEST_SENT_ACTION, since: windowStart, limit: 1 }).catch(() => null);
      if (alreadySent && alreadySent.entries.length > 0) {
        skippedAlreadySent += 1;
        continue;
      }
      const rollup = await getOrgRollup(org, win);
      if (!rollup || rollup.scannedCount === 0) continue; // nothing to report on yet
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
        continue;
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
      if (await dispatchAlert(msg, { webhookUrl })) {
        sent += 1;
        // Stamp the send so a retry/overlap within this window is skipped by the guard above. Best-
        // effort: a lost stamp at worst risks one duplicate, never a dropped digest.
        await recordOrgAudit(DIGEST_SENT_ACTION, org, { weekStart: windowStart.toISOString() }).catch(() => {});
      }
    } catch (err) {
      errors.push(`${org}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }

  return NextResponse.json({ orgs: orgs.length, sent, skippedNoSink, skippedFlat, skippedAlreadySent, errors });
}
