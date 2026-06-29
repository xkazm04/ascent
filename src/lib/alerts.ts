// Regression detection + alert dispatch — the "live intelligence" layer. After an autoscan or a
// push-triggered re-scan, we diff the fresh report against the previously persisted one
// (engine.diffReports → ScanDiff) and decide whether it crossed a line worth interrupting a human
// for: a maturity demotion, a slide into "ungoverned", or a material score/dimension drop.
//
// The detector + message builder are PURE (unit-tested). dispatchAlert() is the only side-effect:
// it POSTs a Slack-compatible payload to the resolved sink — the org's own webhook
// (Organization.alertWebhookUrl, threaded in by the caller) when set, else the global
// ALERT_WEBHOOK_URL — and is otherwise a graceful no-op so the feature degrades cleanly with no
// configuration. Per-org routing keeps one tenant's fleet intelligence out of another's channel.

import type { ScanDiff } from "@/lib/report/compare";
import { isWithinNoise } from "@/lib/maturity/noise";
import { isPrivateOrInternalHost } from "@/lib/net/ssrf";

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

// The overall-drop threshold (5) sits comfortably ABOVE the scan-to-scan noise band (±2 — two identical-
// commit re-scans moved 0/±1; see @/lib/maturity/noise), so a regression alert never fires on model
// jitter. The dimension threshold (15) is well clear of the ±25 LLM guardband on a single dimension.
export const DEFAULT_THRESHOLDS: RegressionThresholds = { overallDrop: 5, dimensionDrop: 15 };

/**
 * Movement-gate for the weekly fleet digest — whether this period is worth a push at all. A leader who
 * relies on the digest *instead of* opening the app filters it out fast if it cries "no change this
 * week" every Monday, so a flat period should stay silent. Sends only on real signal: a level change, a
 * regression, an overall move beyond the scan-to-scan noise band, a genuine gainer, or a depleting
 * credit balance (always worth the heads-up). Pure — the cron passes the period's already-computed
 * aggregates. This is an adaptive cadence (notify on news); a fixed per-org cadence would need a stored
 * preference + last-sent timestamp.
 */
export function digestHasSignal(s: {
  overallDelta: number | null;
  levelChanges: number;
  regressions: number;
  gainersBeyondNoise: number;
  creditLow: boolean;
}): boolean {
  if (s.creditLow) return true;
  if (s.levelChanges > 0 || s.regressions > 0 || s.gainersBeyondNoise > 0) return true;
  return s.overallDelta != null && !isWithinNoise(s.overallDelta);
}

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

/** A Slack Block-Kit `section` block with an `mrkdwn` text body — the shape the four message builders
 *  restated inline ~7 times. Pure; returns a fresh object each call. */
function mrkdwnSection(text: string): { type: "section"; text: { type: "mrkdwn"; text: string } } {
  return { type: "section", text: { type: "mrkdwn", text } };
}

/** A Slack Block-Kit `context` block carrying a single `<url|label>` mrkdwn link — the footer the
 *  builders restated 3 times. Pure. */
function linkContext(url: string, label: string): { type: "context"; elements: { type: "mrkdwn"; text: string }[] } {
  return { type: "context", elements: [{ type: "mrkdwn", text: `<${url}|${label}>` }] };
}

/** Format a signed integer with an explicit leading sign for non-negatives (`+5`, `-3`, `0` → `+0`).
 *  Single-sources the `${n > 0 ? "+" : ""}${n}` idiom buildFleetDigestMessage restated three times.
 *  The boundary is `>= 0` to match the `gain` site; the two delta sites are only reached for a NONZERO
 *  move (a 0 overall delta renders as "no change" before this is called), so they never observe 0 —
 *  unifying on `>= 0` reproduces every previously-emitted string byte-for-byte. */
function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

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
    mrkdwnSection(`*${headline}*`),
    mrkdwnSection(reasonLines.join("\n")),
  ];
  if (why.length) {
    blocks.push(mrkdwnSection(`*Why:*\n${why.map((m) => `• ${m}`).join("\n")}`));
  }
  if (repo.url) {
    blocks.push(linkContext(repo.url, "View report"));
  }
  return { text, blocks };
}

/** Inputs for a weekly fleet digest — the periodic positive push, not just per-repo regressions. */
export interface FleetDigestInput {
  org: string;
  url?: string;
  repoCount: number;
  scannedCount: number;
  avgOverall: number;
  level: string; // e.g. "L3 · Defined"
  overallDelta: number | null; // vs the week's start (null = no baseline)
  gainers: { name: string; delta: number }[];
  regressers: { name: string; delta: number }[];
  topRecommendation: { title: string; repoCount: number } | null;
  /** Corpus percentile (0..100) for the exec digest, or null/undefined when no corpus yet. */
  percentile?: number | null;
  /** One-line forecast trajectory headline, or null/undefined when there's too little history. */
  trajectory?: string | null;
  /** Prepaid credits remaining, when the org is metered and running low — null/undefined omits the line. */
  creditsRemaining?: number | null;
}

/**
 * Build a Slack-compatible weekly fleet digest. Pure (no env, no Date). Turns the dashboard's
 * pull-only aggregates into a push channel: where regressions alert per-repo on a slide, this is the
 * positive periodic rollup (maturity, top movers, the highest-leverage gap) a leader gets without
 * opening the app — the habit loop org-analytics products live on.
 */
export function buildFleetDigestMessage(d: FleetDigestInput): AlertMessage {
  const delta =
    d.overallDelta == null
      ? ""
      : isWithinNoise(d.overallDelta)
        ? d.overallDelta === 0
          ? " (no change this week)"
          : ` (${signed(d.overallDelta)} — within noise this week)`
        : ` (${signed(d.overallDelta)} this week)`;
  const headline = `📊 Ascent weekly digest: ${d.org}`;
  const pctile = d.percentile != null ? ` · ${d.percentile}th pctile` : "";
  const summary = `Fleet maturity *${d.avgOverall}/100* · ${d.level}${delta} — ${d.scannedCount}/${d.repoCount} repos scanned${pctile}`;
  const gain = (m: { name: string; delta: number }) => `• ${m.name} ${signed(m.delta)}`;

  const lines: string[] = [headline, summary.replace(/\*/g, "")];
  if (d.trajectory) lines.push(d.trajectory);
  if (d.gainers.length) lines.push("", "Top gainers:", ...d.gainers.map(gain));
  if (d.regressers.length) lines.push("", "Regressions:", ...d.regressers.map(gain));
  if (d.topRecommendation)
    lines.push("", `Highest-leverage gap: ${d.topRecommendation.title} (affects ${d.topRecommendation.repoCount} repo${d.topRecommendation.repoCount === 1 ? "" : "s"})`);
  if (d.creditsRemaining != null)
    lines.push("", `Credits remaining: ${d.creditsRemaining} — top up to keep autoscans flowing`);
  if (d.url) lines.push("", d.url);

  const blocks: unknown[] = [
    mrkdwnSection(`*${headline}*\n${summary}${d.trajectory ? `\n_${d.trajectory}_` : ""}`),
  ];
  const mv: string[] = [];
  if (d.gainers.length) mv.push(`*Top gainers:*\n${d.gainers.map(gain).join("\n")}`);
  if (d.regressers.length) mv.push(`*Regressions:*\n${d.regressers.map(gain).join("\n")}`);
  if (mv.length) blocks.push(mrkdwnSection(mv.join("\n\n")));
  if (d.topRecommendation)
    blocks.push(
      mrkdwnSection(
        `*Highest-leverage gap:* ${d.topRecommendation.title} _(affects ${d.topRecommendation.repoCount} repo${d.topRecommendation.repoCount === 1 ? "" : "s"})_`,
      ),
    );
  if (d.creditsRemaining != null)
    blocks.push(mrkdwnSection(`*Credits remaining:* ${d.creditsRemaining} — top up to keep autoscans flowing`));
  if (d.url) blocks.push(linkContext(d.url, "Open the dashboard"));
  return { text: lines.join("\n"), blocks };
}

/** Inputs for a prepaid-credit lifecycle alert (low-water crossing or depletion). */
export interface LowCreditsInput {
  org: string;
  /** Balance after the debit that triggered the alert. */
  balance: number;
  /** The configured low-water mark the balance just landed on. */
  threshold: number;
  /** Link to the org dashboard (where the credits control lives), when a public base is known. */
  url?: string;
}

const DEFAULT_CREDITS_ALERT_THRESHOLD = 5;

/** Low-water mark for credit alerts: CREDITS_ALERT_THRESHOLD (non-negative integer), default 5.
 *  A blank/missing var means "default", never 0 — same blank-vs-zero rule as the cost rates. */
export function creditsAlertThreshold(): number {
  const raw = process.env.CREDITS_ALERT_THRESHOLD;
  if (raw == null || raw.trim() === "") return DEFAULT_CREDITS_ALERT_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : DEFAULT_CREDITS_ALERT_THRESHOLD;
}

/**
 * Whether a debit landing on `balanceAfter` crosses an alert line. Pure. Debits are unit-sized
 * (one credit per scan), so the balance lands EXACTLY on the threshold once on the way down and
 * exactly on 0 once at depletion — each crossing fires once with no dedupe state.
 */
export function isLowCreditsCrossing(balanceAfter: number, threshold: number): boolean {
  return balanceAfter === 0 || balanceAfter === threshold;
}

/**
 * Build a Slack-compatible low-credits / depleted-balance alert. Pure (no env, no Date). Running
 * out of credits is a prepaid model's silent churn moment — autoscans stop and the trends the org
 * paid for flatline — so the crossing gets a proactive push through the same sink as regressions
 * and the weekly digest.
 */
export function buildLowCreditsMessage(d: LowCreditsInput): AlertMessage {
  const depleted = d.balance <= 0;
  const headline = depleted
    ? `🪫 Ascent: ${d.org} is out of scan credits`
    : `🪫 Ascent: ${d.org} is low on scan credits — ${d.balance} left`;
  const body = depleted
    ? "Private scans (manual and scheduled) are paused until the balance is topped up — maturity trends stop updating."
    : `The prepaid balance just hit the low-water mark (${d.threshold}). Top up before it runs out to keep scheduled scans flowing.`;

  const textParts = [headline, body];
  if (d.url) textParts.push("", d.url);
  const blocks: unknown[] = [mrkdwnSection(`*${headline}*\n${body}`)];
  if (d.url) blocks.push(linkContext(d.url, "Manage credits"));
  return { text: textParts.join("\n"), blocks };
}

/**
 * Build the "test alert" message an admin sends to confirm their sink is wired up. Pure — the same
 * shape as the other builders (plain-text fallback + a single Block-Kit section), so the test send
 * stops hand-assembling Block Kit inside the API route and joins the unit-tested builder family.
 */
export function buildTestAlertMessage(org: string): AlertMessage {
  const headline = `✅ Ascent test alert for ${org}`;
  const body = "If you can read this in your channel, alert routing works. Regression, low-credit and weekly-digest alerts will arrive here.";
  return {
    text: `${headline}\n${body}`,
    blocks: [mrkdwnSection(`*${headline}*\n${body}`)],
  };
}

/**
 * Resolve the sink an alert should POST to: the org's own webhook when set (multi-tenant routing —
 * each tenant gets its own fleet intelligence), else the global ALERT_WEBHOOK_URL (single-tenant /
 * operator deployments), else null (no-op). Pure given its argument — the env read is the only
 * ambient input, matching the layer's existing convention.
 */
export function resolveAlertWebhook(orgWebhookUrl?: string | null): string | null {
  const org = orgWebhookUrl?.trim();
  if (org) return org;
  const global = process.env.ALERT_WEBHOOK_URL?.trim();
  return global || null;
}

/** Whether an alert sink is configured (so callers can skip the work entirely when it isn't).
 *  Pass the org's webhook (when known) so a tenant with its own sink counts even with no global. */
export function isAlertConfigured(orgWebhookUrl?: string | null): boolean {
  return resolveAlertWebhook(orgWebhookUrl) !== null;
}

/**
 * Validate a caller-supplied org webhook URL before storing it. Pure (unit-tested). The server
 * POSTs org data to this URL, so it must parse, be https, carry no inline credentials, and not
 * target a private/internal host — the established "validate outbound URLs built from caller input"
 * rule. The private/internal host check is the SHARED isPrivateOrInternalHost guard (same one the
 * branding logo-URL guard uses), so this now also rejects CGNAT 100.64/10, IPv6 unique-local
 * (fc00::/7) and link-local (fe80::), multicast/reserved, and internal hostnames (*.local/*.internal/
 * cloud metadata) the old hand-rolled list missed. DNS-rebinding is out of scope here.
 */
export function validateAlertWebhookUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length > 1000) return { ok: false, error: "Webhook URL is too long (max 1000 chars)." };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Not a valid URL." };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: "Webhook must be an https:// URL." };
  if (parsed.username || parsed.password) return { ok: false, error: "Credentials in the URL are not allowed." };
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 [..] brackets
  if (isPrivateOrInternalHost(host)) return { ok: false, error: "Webhook host must be publicly reachable." };
  return { ok: true, url: parsed.toString() };
}

/**
 * POST an alert to its sink (Slack incoming-webhook compatible): `opts.webhookUrl` (the org's own
 * sink) when set, falling back to the global ALERT_WEBHOOK_URL. Returns true on a 2xx, false on any
 * failure or when no sink is configured — never throws, so a flaky webhook can't fail the scan that
 * produced the alert. `signal` lets a caller abort with the surrounding work.
 */
export async function dispatchAlert(
  message: AlertMessage,
  opts: { signal?: AbortSignal; webhookUrl?: string | null } = {},
): Promise<boolean> {
  const url = resolveAlertWebhook(opts.webhookUrl);
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
