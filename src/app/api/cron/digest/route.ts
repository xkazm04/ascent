// GET /api/cron/digest — weekly fleet digest. Invoked by Vercel Cron (see vercel.json). For each org
// with watched repos, summarize the past week (rollup + top movers + the highest-leverage gap) and
// POST a Block-Kit message to the org's own webhook (Organization.alertWebhookUrl) when set, falling
// back to the global ALERT_WEBHOOK_URL. Where regression alerts fire per-repo on a slide, this is the
// positive periodic push that keeps a leader engaged without opening the app — routed per tenant so
// each customer receives its own fleet intelligence rather than everything landing in the operator's
// channel. Orgs with no resolvable sink are skipped (counted in the response), so a deployment with
// neither configured is a clean no-op.
//
// DELIBERATE SPLIT from the per-org regression thresholds (ambiguity-ui 2026-07-16 #2): the digest's
// gainers/regressers lists are gated by the GLOBAL isWithinNoise band, NOT by the org's configured
// "Regression sensitivity" thresholds. Those thresholds tune when a single repo's slide fires a
// PER-REPO alert (scan-alerts.ts); the digest's movers section is a fleet summary where a shared
// noise floor keeps cross-org semantics comparable ("beyond measurement jitter"), not an alarm the
// org tunes. The AlertsControl UI states the same scope, so the two surfaces agree.
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
  getRedBaselines,
  getStandingRegressions,
  isDbConfigured,
  listOrgsWithWatchedRepos,
  recordAlertEvent,
  type OrgWindow,
} from "@/lib/db";
// Direct submodule import: the atomic once-per-window claim helpers are not re-exported through the
// @/lib/db barrel. They collapse the digest's old check-then-act idempotency guard into one conditional
// write (fleet-alerts-digests #3).
import { claimOrgAuditOnce, releaseAuditClaim } from "@/lib/db/scans-audit";
import { requireCronAuth } from "@/lib/cron-auth";
import { buildFleetDigestMessage, creditsAlertThreshold, digestHasSignal, dispatchAlert, isAlertConfigured } from "@/lib/alerts";
import { controlLabel } from "@/lib/controls/catalog";
import { controlCoverage, listObservationsSince } from "@/lib/db/control-observations";
import { dispatchExtraAlerts } from "./extra-alerts";
import { mapPool } from "@/lib/pool";
import { PUBLIC_ORG } from "@/lib/auth";
import { isWithinNoise } from "@/lib/maturity/noise";
import { levelForScore } from "@/lib/maturity/model";
import { trajectoryLine } from "@/lib/maturity/forecast";
import { publicBaseUrl } from "@/lib/site";
import { resolveWindow, weekRangeParams } from "@/lib/window";
import { orgWindowBounds } from "@/lib/org/period";
import { orgTabHref } from "@/lib/org/orgTabs";

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
// Audit action stamped after each successful per-org digest send. It doubles as the at-most-once
// idempotency key for the window (skip an org that already has one within the current 7-day window) —
// migration-free, since Organization has no spare last-sent column under the junctioned DB client.
const DIGEST_SENT_ACTION = "org.digest.sent";

export async function GET(request: Request) {
  // Fail-closed CRON_SECRET gate (503 when unset/empty, 401 on a bad credential), header-only and
  // compared in constant time. This route hand-rolled that check because the shared helper used to be
  // WEAKER (it accepted `?key=` and compared with `!==`); G8-48 promoted the strict contract into
  // requireCronAuth. `?key=` stays refused by default (fleet-alerts-digests #2): query strings land in
  // access/CDN/proxy logs, browser history and Referer headers, so a secret there could authorize a
  // fleet-data exfil from places the Authorization header never reaches.
  const denied = requireCronAuth(request);
  if (denied) return denied;
  if (!isDbConfigured()) return NextResponse.json({ skipped: "Database required." });

  const base = publicBaseUrl();
  const orgs = await listOrgsWithWatchedRepos();
  // Derive "this week" from the SHARED period helper (a custom range snapped to local calendar days)
  // instead of a hand-rolled rolling 168h offset, so the digest's "+N this week" deltas and the
  // executive page it links to (which resolves the same ?range=custom&from=&to=) agree on identical
  // period boundaries rather than disagreeing by up to a day. (fleet-alerts-digests #5)
  const weekParams = weekRangeParams();
  const period = resolveWindow(weekParams);
  const windowStart = period.start ?? new Date(Date.now() - 7 * 86_400_000);
  // Half-open `{ start, endExclusive }` from the one adapter — the digest and the Briefing page it
  // links to must not close the same week differently.
  const win: OrgWindow = orgWindowBounds(period);
  // Query string that makes the linked briefing reproduce the digest's exact window.
  const periodQs = `range=custom&from=${weekParams.from}&to=${weekParams.to}`;

  let sent = 0;
  let failed = 0;
  let skippedNoSink = 0;
  let skippedFlat = 0;
  let skippedNoData = 0;
  let remaining = 0;
  let skippedAlreadySent = 0;
  let goalAlerts = 0;
  let spendAlerts = 0;
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
      //
      // "Lookup FAILED" must never be conflated with "no webhook configured": the old
      // `.catch(() => null)` turned a transient DB error into null, which resolveAlertWebhook treats
      // as an intentional single-tenant config — so a tenant's fleet digest (scores, movers, credit
      // balance) POSTed to the operator's GLOBAL sink, and the successful misrouted dispatch kept the
      // at-most-once window claim, dropping the tenant's digest for the week with no retry. Let a
      // lookup failure PROPAGATE to this per-org try/catch: the org is counted in `errors` and
      // skipped before any claim is taken, so the next run self-heals. Only a genuine null (row read
      // OK, column empty) reaches the global fallback. (fleet-alerts-digests 2026-07-16 #1)
      const webhookUrl = await getOrgAlertWebhook(org);
      if (!isAlertConfigured(webhookUrl)) {
        skippedNoSink += 1;
        return;
      }
      // At-most-once per window: this handler loops every org under maxDuration and can time out
      // partway, be retried by the platform, or overlap a re-fired schedule. Without a last-sent guard
      // every already-notified org would receive the weekly digest AGAIN (eroding the exact push channel
      // the feature makes habit-forming). Skip an org that already got a digest within this window —
      // recorded as an audit entry after each successful dispatch below.
      const alreadySent = await getAuditLog(org, { action: DIGEST_SENT_ACTION, since: windowStart, limit: 1 }).catch(() => null);
      if (alreadySent && alreadySent.entries.length > 0) {
        skippedAlreadySent += 1;
        return;
      }
      // G7-03: the goal-at-risk / spend-anomaly pushes ride this run (see ./extra-alerts). Placed
      // BEFORE the rollup and the movement-gate on purpose — a goal sliding off pace or a spend spike
      // is exactly the kind of news a FLAT fleet week still needs to carry, and the digest's silence-
      // on-noise gate would otherwise suppress it. Each carries its own at-most-once window claim, so
      // this is not gated by the digest's, and the whole call is internally defensive: it can add
      // `errors` but can never fail the digest.
      const extra = await dispatchExtraAlerts({ org, webhookUrl, base, windowStart, periodQs });
      goalAlerts += extra.goalAlerts;
      spendAlerts += extra.spendAlerts;
      errors.push(...extra.errors);

      const rollup = await getOrgRollup(org, win);
      if (!rollup || rollup.scannedCount === 0) {
        // Nothing to report on yet (no rollup, or zero scanned repos) — counted so `orgs.length`
        // reconciles against the sum of all counters instead of these orgs silently vanishing.
        skippedNoData += 1;
        return;
      }
      const [movers, recs, benchmark, credit, controlTransitions, coverage, standing, redBaselines] = await Promise.all([
        getOrgMovers(org, win).catch(() => null),
        getOrgRecommendations(org, 1).catch(() => null),
        getOrgBenchmark(org).catch(() => null),
        // Credit runway for the digest's "top up" line — public org is free/unmetered, skip it.
        org === PUBLIC_ORG ? Promise.resolve(null) : getCreditState(org).catch(() => null),
        // MOONSHOT #1: control transitions in the window feed the digest's Controls block. Failures
        // only — a restored control is good news the weekly summary need not push.
        //
        // NULL ON FAILURE, NOT `[]` (UAT `DANA-L1-015`). The block's three-state contract needs the
        // difference between "we read the ledger and nothing failed" and "we could not read it": an
        // error swallowed into an empty array collapses exactly the two states `alerts.ts` documents.
        listObservationsSince(org, windowStart.toISOString(), { transitionsOnly: true }).catch(() => null),
        // …and the N the block is stated with, over the same window. Same null-on-failure rule: a
        // coverage line the digest could not compute is omitted, never printed as zero.
        controlCoverage(org, { from: windowStart.toISOString() }).catch(() => null),
        // Standing concerns: dimensions holding materially below an earlier reading. Computed from
        // persisted scans only, and DELIBERATELY not window-scoped — the whole failure this closes is a
        // decline that stopped moving, so a shortfall that began before this week is exactly the one
        // every windowed surface has already been silent about. Best-effort.
        getStandingRegressions(org, { limit: 5 }).catch(() => []),
        // A RED BASELINE IS THE SAME KIND OF FACT, from a different column. The improvement loop's
        // degradation guard records `baseline-red` when a repository's OWN check was already failing
        // before an agent touched it — which means the guard cannot compare anything and everything
        // the loop commits there is unverified. It is a state, not an event, so every windowed and
        // movement-shaped signal is silent about it, exactly as they are about a decline that stopped
        // moving. Same block, same voice, not window-scoped for the same reason. Best-effort.
        getRedBaselines(org, { limit: 5 }).catch(() => []),
      ]);
      // ONE list, deliberately. A red baseline is not a second kind of concern needing a second
      // heading: the heading already says these are observations with no cause attributed, and each
      // line names its own subject (a dimension, or the command a repository declares for itself).
      // Red baselines lead, because a guard that cannot run outranks a score that fell.
      const standingRows = [
        ...redBaselines.map((b) => ({
          repo: b.repoFullName,
          observation: b.observation,
          ...(b.evidence.length > 0 ? { evidence: b.evidence } : {}),
        })),
        ...standing.map((c) => ({
          repo: c.repoFullName,
          observation: c.observation,
          ...(c.evidence ? { evidence: c.evidence } : {}),
        })),
      ];
      // Null (the ledger could not be read) stays null all the way to the message, where `undefined`
      // omits the block. An empty ARRAY is the positive statement "we looked and none failed" and is
      // passed through as one — it used to be turned back into `undefined`, which made a clean week
      // byte-identical to a week nobody measured.
      const controlsFailedRows = controlTransitions
        ? controlTransitions
            .filter((o) => o.state === "fail")
            .slice(0, 10)
            .map((o) => ({
              repo: o.repoFullName,
              control: controlLabel(o.controlId),
              detail: o.prevState && o.prevState !== o.state ? `was ${o.prevState}` : (o.value ?? ""),
            }))
        : null;
      // Fleet-level roll-up of the per-pair coverage rows: the digest states one N for one block, and
      // `maxGapDays` is the WORST pair's gap, because a coverage claim is only as strong as its
      // thinnest evidence. Null pairs (a single observation) contribute no gap rather than a 0.
      const coverageSummary = coverage
        ? {
            pairs: coverage.length,
            observations: coverage.reduce((n, c) => n + c.observations, 0),
            maxGapDays: coverage.reduce<number | null>((m, c) => (c.maxGapDays == null ? m : Math.max(m ?? 0, c.maxGapDays)), null),
            truncated: coverage.some((c) => c.windowTruncated),
          }
        : undefined;
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
        controlsFailed: controlsFailedRows?.length ?? 0,
        standingConcerns: standingRows.length,
      });
      if (!hasSignal) {
        skippedFlat += 1;
        return;
      }
      const level = levelForScore(rollup.avgOverall);
      const top = recs?.[0];
      const msg = buildFleetDigestMessage({
        org,
        // Link to the Weekly digest tab — the in-app page this push summarizes. That page's window is
        // FIXED at the same `weekRangeParams()` trailing week this route resolves above, so no
        // ?range=custom&from=&to= needs to travel: the two cannot disagree about the period. (The extra
        // alerts below still link into the Briefing with `periodQs`, because that page's window is
        // selectable and must be pinned to the week explicitly.)
        url: base ? `${base}${orgTabHref(org, "digest")}` : undefined,
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
        // THE THREE-STATE CONTRACT, KEPT (UAT `DANA-L1-015`). `undefined` (ledger unreadable) omits
        // the block; `[]` says "we looked and none failed". This used to send `undefined` whenever the
        // array was empty, so the `[]` branch — unit-tested since it shipped — was unreachable from the
        // only production caller and a clean week rendered byte-identical to an unpopulated ledger.
        controlsFailed: controlsFailedRows ?? undefined,
        // …and the block never travels without its N (control-observations.ts's coverage law).
        controlCoverage: coverageSummary,
        standingConcerns: standingRows.length > 0 ? standingRows : undefined,
        percentile: benchmark?.overallPercentile ?? null,
        // MC-B1: the digest gets the SAME composed line as the briefing it links to — the headline
        // with its confidence + basis once the fit is presentable, and the refusal sentence when it
        // is not. A push channel is the worst place to state a slope nobody can question, and the
        // digest previously printed `forecastHeadline` raw, hedge and gate alike bypassed.
        trajectory: trajectoryLine(rollup.forecast),
        // Carry the balance only when the org is metered and running low (the same condition the
        // movement-gate treats as always-worth-sending) — the digest is the one push a leader reliably
        // reads, so a depleting balance gets a standing line there, not just the crossing alert.
        creditsRemaining: creditLow && credit ? credit.balance : null,
      });
      // At-most-once, ATOMICALLY (fleet-alerts-digests #3): claim the window with a single conditional
      // insert whose affected-row count decides the winner, BEFORE dispatching. The old guard read the
      // audit log, dispatched, then stamped AFTER the send — check-then-act — so two overlapping runs (a
      // platform retry, a re-fired schedule) both read "not sent" and both POSTed the same digest. Lost
      // the claim → a concurrent run already owns this window; skip without dispatching.
      const claim = await claimOrgAuditOnce(DIGEST_SENT_ACTION, org, windowStart, { weekStart: windowStart.toISOString() });
      if (!claim.claimed) {
        skippedAlreadySent += 1;
        return;
      }
      const delivered = await dispatchAlert(msg, { webhookUrl, org });
      if (delivered) {
        sent += 1;
      } else {
        // Delivery failed AFTER we claimed the window — RELEASE the claim so the next run retries this
        // org, rather than the window staying falsely marked sent (which would DROP the digest).
        await releaseAuditClaim(claim.id);
        failed += 1; // sink unresolvable at send time, non-2xx, or the deadline aborted the POST
      }
      // History row for the in-app drawer — the released claim forgets a failed window (so next run
      // retries); this row remembers the attempt and its outcome.
      await recordAlertEvent(org, {
        kind: "digest",
        severity: "info",
        title: `Weekly fleet digest (${rollup.scannedCount} repos, avg ${rollup.avgOverall})`,
        body: msg.text,
        delivered,
        sinkKind: webhookUrl && /^mailto:/i.test(webhookUrl) ? "email" : "webhook",
        suppressedReason: delivered ? null : "dispatch-failed",
      });
    } catch (err) {
      errors.push(`${org}: ${err instanceof Error ? err.message : "failed"}`);
    }
  });

  return NextResponse.json({ orgs: orgs.length, sent, failed, skippedNoSink, skippedFlat, skippedNoData, skippedAlreadySent, remaining, goalAlerts, spendAlerts, errors });
}
