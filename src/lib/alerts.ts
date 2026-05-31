// Regression detection + alert dispatch — the "live intelligence" layer. After an autoscan or a
// push-triggered re-scan, we diff the fresh report against the previously persisted one
// (engine.diffReports → ScanDiff) and decide whether it crossed a line worth interrupting a human
// for: a maturity demotion, a slide into "ungoverned", or a material score/dimension drop.
//
// The detector + message builder are PURE (unit-tested). dispatchAlert() is the only side-effect:
// it POSTs a Slack-compatible payload to ALERT_WEBHOOK_URL when set, and is otherwise a graceful
// no-op so the feature degrades cleanly with no configuration.

import type { ScanDiff } from "@/lib/report/compare";

/** How loud the regression is — drives whether/how prominently it's surfaced. */
export type AlertSeverity = "critical" | "warning";

export interface RegressionReason {
  severity: AlertSeverity;
  /** Short, human-readable explanation (e.g. "Maturity dropped L4 → L3"). */
  message: string;
  /** Machine code for routing/testing. */
  code: "level-demotion" | "posture-ungoverned" | "overall-drop" | "dimension-drop";
}

export interface RegressionVerdict {
  regressed: boolean;
  severity: AlertSeverity | null;
  reasons: RegressionReason[];
}

export interface RegressionThresholds {
  /** Overall-score drop (points) that counts as a regression. */
  overallDrop: number;
  /** Single-dimension drop (points) that counts as a regression. */
  dimensionDrop: number;
}

export const DEFAULT_THRESHOLDS: RegressionThresholds = { overallDrop: 5, dimensionDrop: 15 };

/**
 * Decide whether a scan-to-scan diff is a regression worth alerting on. `diff` reads as
 * `after − before`, so negative deltas are slides. Reasons are returned strongest-first; the
 * overall severity is the max of the individual reasons (a level demotion or a slide into
 * "ungoverned" is critical; score/dimension slides are warnings).
 */
export function detectRegression(
  diff: ScanDiff,
  thresholds: RegressionThresholds = DEFAULT_THRESHOLDS,
): RegressionVerdict {
  const reasons: RegressionReason[] = [];

  if (diff.level.changed && !diff.level.up) {
    reasons.push({
      severity: "critical",
      code: "level-demotion",
      message: `Maturity dropped ${diff.level.before.id} → ${diff.level.after.id} (${diff.level.after.name})`,
    });
  }

  // Sliding INTO "ungoverned" (heavy AI, light guardrails) is the posture we most want to catch.
  if (diff.posture.changed && diff.posture.after.id === "ungoverned" && diff.posture.before.id !== "ungoverned") {
    reasons.push({
      severity: "critical",
      code: "posture-ungoverned",
      message: `Posture slid to "${diff.posture.after.label}" — AI velocity outran the guardrails`,
    });
  }

  if (diff.overall.delta <= -thresholds.overallDrop) {
    reasons.push({
      severity: "warning",
      code: "overall-drop",
      message: `Overall score fell ${diff.overall.delta} (${diff.overall.before} → ${diff.overall.after})`,
    });
  }

  const worstDim = diff.dimensions
    .filter((d) => typeof d.delta === "number" && (d.delta as number) <= -thresholds.dimensionDrop)
    .sort((a, b) => (a.delta as number) - (b.delta as number))[0];
  if (worstDim) {
    reasons.push({
      severity: "warning",
      code: "dimension-drop",
      message: `${worstDim.id} ${worstDim.name} fell ${worstDim.delta} (${worstDim.before} → ${worstDim.after})`,
    });
  }

  const regressed = reasons.length > 0;
  const severity: AlertSeverity | null = !regressed
    ? null
    : reasons.some((r) => r.severity === "critical")
      ? "critical"
      : "warning";
  return { regressed, severity, reasons };
}

export interface RepoAlertRef {
  fullName: string;
  /** Absolute or relative link to the report/what-changed view. */
  url?: string;
}

export interface AlertMessage {
  /** Plain-text fallback (Slack `text`). */
  text: string;
  /** Slack Block Kit blocks for a richer card; safe to ignore by non-Slack sinks. */
  blocks: unknown[];
}

const SEV_EMOJI: Record<AlertSeverity, string> = { critical: "🔻", warning: "⚠️" };

/**
 * Build a Slack-compatible alert message from a regression verdict. Pure — no env, no Date.
 * The top movement attributions from the diff are included so the alert explains *why* the
 * score moved, not just that it did.
 */
export function buildRegressionMessage(repo: RepoAlertRef, diff: ScanDiff, verdict: RegressionVerdict): AlertMessage {
  const emoji = SEV_EMOJI[verdict.severity ?? "warning"];
  const headline = `${emoji} Ascent: ${repo.fullName} regressed`;
  const reasonLines = verdict.reasons.map((r) => `• ${r.message}`);
  const why = diff.movements.slice(0, 3);

  const textParts = [headline, ...reasonLines];
  if (why.length) textParts.push("", "Why:", ...why.map((m) => `• ${m}`));
  if (repo.url) textParts.push("", repo.url);
  const text = textParts.join("\n");

  const blocks: unknown[] = [
    { type: "section", text: { type: "mrkdwn", text: `*${headline}*` } },
    { type: "section", text: { type: "mrkdwn", text: reasonLines.join("\n") } },
  ];
  if (why.length) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*Why:*\n${why.map((m) => `• ${m}`).join("\n")}` } });
  }
  if (repo.url) {
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: `<${repo.url}|View report>` }] });
  }
  return { text, blocks };
}

/** Whether an alert sink is configured (so callers can skip the work entirely when it isn't). */
export function isAlertConfigured(): boolean {
  return Boolean(process.env.ALERT_WEBHOOK_URL);
}

/**
 * POST an alert to ALERT_WEBHOOK_URL (Slack incoming-webhook compatible). Returns true on a 2xx,
 * false on any failure or when no sink is configured — never throws, so a flaky webhook can't
 * fail the scan that produced the alert. `signal` lets a caller abort with the surrounding work.
 */
export async function dispatchAlert(message: AlertMessage, opts: { signal?: AbortSignal } = {}): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: message.text, blocks: message.blocks }),
      signal: opts.signal,
    });
    if (!res.ok) {
      console.error("[alerts] dispatch failed", { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    console.error("[alerts] dispatch error", err instanceof Error ? err.message : err);
    return false;
  }
}
