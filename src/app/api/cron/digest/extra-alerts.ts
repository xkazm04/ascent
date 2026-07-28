// G7-03 — the two trigger classes the weekly run can compute from data it already owns: a GOAL sliding
// off pace, and a SPEND spike. Both were "the leader has to remember to open the tab" gaps on the one
// push channel the product has.
//
// WHY THEY RIDE THE DIGEST CRON. Neither needs same-day latency (a goal drifts over weeks; a spend
// spike is a budget conversation, not a page), and the digest run already resolves each org's sink,
// already holds a per-window at-most-once claim discipline, and already runs under a soft deadline with
// bounded concurrency. Adding a third cron would duplicate all of that to say the same things later.
//
// The SECURITY class from the same backlog item ships as a pure builder (buildSecurityAlertMessage in
// src/lib/alerts.ts) but is NOT dispatched here: a fresh critical advisory or a gate pass→fail flip is
// a same-day event whose natural trigger is the scan pipeline's post-scan diff (src/lib/scan-alerts.ts),
// not a weekly sweep — firing it weekly would be worse than not firing it, because it would arrive
// stale and train the reader to treat security pushes as routine.
//
// EVERY dispatch here is subject to the same routing as the digest itself: the org's own sink (webhook
// OR mailto:, see G7-01), else the global ALERT_WEBHOOK_URL, else nothing. No sink → no work.

import { listGoals, getUsageSummary } from "@/lib/db";
import { claimOrgAuditOnce, releaseAuditClaim } from "@/lib/db/scans-audit";
import {
  buildGoalAtRiskMessage,
  buildSpendAnomalyMessage,
  dispatchAlert,
  isSpendAnomaly,
  type GoalRisk,
} from "@/lib/alerts";

/** Audit actions doubling as the per-window at-most-once keys (same pattern as DIGEST_SENT_ACTION). */
export const GOAL_RISK_ACTION = "org.alert.goal-at-risk";
export const SPEND_ANOMALY_ACTION = "org.alert.spend-anomaly";

/** Trailing window for the spend baseline: the current 7 days measured against the prior 21. */
const SPEND_PERIOD_DAYS = 7;
const SPEND_BASELINE_DAYS = 21;

export interface ExtraAlertContext {
  org: string;
  /** The org's resolved sink (already known to be configured by the caller). */
  webhookUrl: string | null;
  /** Public base URL, or "" when none is configured (links are then omitted). */
  base: string;
  /** Start of the current digest window — the at-most-once scope. */
  windowStart: Date;
  /** `range=custom&from=&to=` so a linked page reproduces the digest's window. */
  periodQs: string;
}

export interface ExtraAlertResult {
  goalAlerts: number;
  spendAlerts: number;
  errors: string[];
}

/**
 * Claim → dispatch → release-on-failure, the exact discipline the digest uses. Returns true only when a
 * message was actually delivered. Never throws.
 */
async function claimAndDispatch(
  action: string,
  ctx: ExtraAlertContext,
  build: () => { text: string; blocks: unknown[] },
  meta: Record<string, unknown>,
): Promise<boolean> {
  const claim = await claimOrgAuditOnce(action, ctx.org, ctx.windowStart, meta);
  if (!claim.claimed) return false;
  const ok = await dispatchAlert(build(), { webhookUrl: ctx.webhookUrl, org: ctx.org });
  if (!ok && claim.id) await releaseAuditClaim(claim.id).catch(() => {});
  return ok;
}

/** Goals the plan layer already marks as behind — the alert's whole trigger condition. */
function behindGoals(goals: Awaited<ReturnType<typeof listGoals>>): GoalRisk[] {
  return (goals ?? [])
    .filter((g) => g.pace === "behind" && !g.achieved)
    .map((g) => ({
      label: g.label,
      metricLabel: g.metricLabel,
      current: g.current,
      target: g.target,
      targetDate: g.targetDate,
      requiredPerWeek: g.requiredPerWeek,
      perWeek: g.perWeek,
    }));
}

/**
 * Sum the billable scans of the last `SPEND_PERIOD_DAYS` days and of the `SPEND_BASELINE_DAYS` before
 * them, from the usage layer's UTC day series (the same buckets the /usage chart draws, so the alert
 * and the page a reader opens next can't disagree). Pure.
 */
export function splitSpendWindows(daily: { billable: number }[]): { period: number; baselinePerPeriod: number } {
  const period = daily.slice(-SPEND_PERIOD_DAYS).reduce((n, d) => n + d.billable, 0);
  const prior = daily.slice(-(SPEND_PERIOD_DAYS + SPEND_BASELINE_DAYS), -SPEND_PERIOD_DAYS);
  const baselinePerPeriod = prior.length ? (prior.reduce((n, d) => n + d.billable, 0) / prior.length) * SPEND_PERIOD_DAYS : 0;
  return { period, baselinePerPeriod };
}

/**
 * Dispatch the goal-at-risk and spend-anomaly pushes for ONE org. Fully defensive — every read and
 * every send is individually caught, because this is an ADDITION to the weekly digest and must never
 * be able to fail (or slow past its own budget) the digest that carried it.
 */
export async function dispatchExtraAlerts(ctx: ExtraAlertContext): Promise<ExtraAlertResult> {
  const out: ExtraAlertResult = { goalAlerts: 0, spendAlerts: 0, errors: [] };

  try {
    const goals = behindGoals(await listGoals(ctx.org));
    if (goals.length > 0) {
      const sent = await claimAndDispatch(
        GOAL_RISK_ACTION,
        ctx,
        () =>
          buildGoalAtRiskMessage({
            org: ctx.org,
            url: ctx.base ? `${ctx.base}/org/${encodeURIComponent(ctx.org)}/plan?${ctx.periodQs}` : undefined,
            goals,
          }),
        { goals: goals.length, weekStart: ctx.windowStart.toISOString() },
      );
      if (sent) out.goalAlerts += 1;
    }
  } catch (err) {
    out.errors.push(`${ctx.org}: goal-at-risk ${err instanceof Error ? err.message : "failed"}`);
  }

  try {
    const usage = await getUsageSummary(ctx.org, SPEND_PERIOD_DAYS + SPEND_BASELINE_DAYS);
    if (usage) {
      const { period, baselinePerPeriod } = splitSpendWindows(usage.daily);
      if (isSpendAnomaly(period, baselinePerPeriod)) {
        const sent = await claimAndDispatch(
          SPEND_ANOMALY_ACTION,
          ctx,
          () =>
            buildSpendAnomalyMessage({
              org: ctx.org,
              url: ctx.base ? `${ctx.base}/usage?org=${encodeURIComponent(ctx.org)}` : undefined,
              periodScans: period,
              baseline: baselinePerPeriod,
              ratio: baselinePerPeriod > 0 ? period / baselinePerPeriod : 0,
              estimatedCostUsd: usage.estimatedCostUsd,
            }),
          { periodScans: period, baseline: Math.round(baselinePerPeriod), weekStart: ctx.windowStart.toISOString() },
        );
        if (sent) out.spendAlerts += 1;
      }
    }
  } catch (err) {
    out.errors.push(`${ctx.org}: spend-anomaly ${err instanceof Error ? err.message : "failed"}`);
  }

  return out;
}
