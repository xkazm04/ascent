// Glue between a freshly-persisted scan and the alert layer: diff the new report against the
// repo's previously persisted one, decide if it regressed, record it to the audit trail, and
// (when a sink is configured) dispatch a Slack-compatible alert. Used by the autoscan cron and
// the push-triggered webhook re-scan — the "live intelligence" loop.
//
// Caller contract: capture `prev` (the latest persisted report) BEFORE persisting the fresh scan,
// then call this with both. A missing `prev` (first scan) or a dedup (unchanged commit) → no-op.

import type { ScanReport } from "@/lib/types";
import { diffReports } from "@/lib/scoring/engine";
import { buildRegressionMessage, detectRegression, dispatchAlert, isAlertConfigured, type RegressionVerdict } from "@/lib/alerts";
import { recordAudit, reportPermalink } from "@/lib/db";

export interface RegressionOutcome {
  regressed: boolean;
  verdict: RegressionVerdict | null;
  /** Whether an alert was actually dispatched to a configured sink. */
  dispatched: boolean;
}

/** Absolute report URL when a public base is configured, else the relative permalink. */
function reportUrl(fullName: string, headSha?: string | null): string {
  const base = (process.env.ASCENT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  return `${base}${reportPermalink(fullName, headSha)}`;
}

/**
 * Compare `fresh` against `prev` and act on a regression. Records a `scan.regression` audit entry
 * whenever a regression is detected (so it's tracked even with no alert sink), and dispatches an
 * alert when ALERT_WEBHOOK_URL is set. Never throws — alerting must not fail the scan.
 */
export async function checkAndAlertRegression(
  prev: ScanReport | null,
  fresh: ScanReport,
  opts: { orgId?: string; signal?: AbortSignal } = {},
): Promise<RegressionOutcome> {
  if (!prev) return { regressed: false, verdict: null, dispatched: false };
  try {
    const diff = diffReports(prev, fresh);
    const verdict = detectRegression(diff);
    if (!verdict.regressed) return { regressed: false, verdict, dispatched: false };

    const fullName = `${fresh.repo.owner}/${fresh.repo.name}`;
    await recordAudit(
      "scan.regression",
      {
        repo: fullName,
        severity: verdict.severity,
        reasons: verdict.reasons.map((r) => r.code),
        from: { level: diff.level.before.id, overall: diff.overall.before },
        to: { level: diff.level.after.id, overall: diff.overall.after },
      },
      { orgId: opts.orgId },
    );

    let dispatched = false;
    if (isAlertConfigured()) {
      const message = buildRegressionMessage({ fullName, url: reportUrl(fullName, fresh.repo.headSha) }, diff, verdict);
      dispatched = await dispatchAlert(message, { signal: opts.signal });
    }
    return { regressed: true, verdict, dispatched };
  } catch (err) {
    console.error("[scan-alerts] regression check failed", err instanceof Error ? err.message : err);
    return { regressed: false, verdict: null, dispatched: false };
  }
}
