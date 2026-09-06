// Glue between a freshly-persisted scan and the alert layer: diff the new report against the
// repo's previously persisted one, decide if it regressed, record it to the audit trail, and
// (when a sink is configured) dispatch a Slack-compatible alert. Used by the autoscan cron and
// the push-triggered webhook re-scan — the "live intelligence" loop.
//
// Caller contract: capture `prev` (the latest persisted report) BEFORE persisting the fresh scan,
// then call this with both. A missing `prev` (first scan) or a dedup (unchanged commit) → no-op.

import type { ScanReport } from "@/lib/types";
import { diffReports } from "@/lib/scoring/engine";
import {
  buildLowCreditsMessage,
  buildPromotionMessage,
  buildRegressionMessage,
  buildControlAlertMessage,
  buildSecurityAlertMessage,
  claimRegressionAlert,
  controlAlertSeverity,
  controlCooldownKey,
  type ControlAlertItem,
  creditsAlertThreshold,
  DEFAULT_THRESHOLDS,
  detectPromotion,
  detectRegression,
  dispatchAlert,
  emailSinkAddress,
  isLowCreditsCrossing,
  resolveAlertWebhook,
  type AlertMessage,
  type RegressionVerdict,
} from "@/lib/alerts";
import { getAuditLog, getOrgAlertThresholds, getOrgAlertWebhook, recordAlertEvent, recordAudit, reportPermalink } from "@/lib/db";
import type { AlertEventInput } from "@/lib/db";
import { publicBaseUrl } from "@/lib/site";
import { SCORING_RUBRIC_VERSION } from "@/lib/maturity/model";
// MOONSHOT #1 — the control ledger is the SOURCE for the control push; `ScanDiff` gains no
// governance field, because a flip observed by a probe between two scans would never appear in one.
import { listObservationsSince } from "@/lib/db/control-observations";
import { isDispatchable, transitionsFromRows } from "@/lib/controls/transitions";
import { controlLabel } from "@/lib/controls/catalog";
import {
  AUTO_RECHARGE_ACTION,
  normalizeAutoRecharge,
} from "@/components/org/shared/CreditsControl.autorecharge";

export interface RegressionOutcome {
  regressed: boolean;
  verdict: RegressionVerdict | null;
  /** Whether an alert was actually dispatched to a configured sink (regression OR promotion). */
  dispatched: boolean;
  /** Whether this scan crossed a maturity band UPWARD and took the celebratory path instead. */
  promoted?: boolean;
  /** Set when `prev` was scored under a DIFFERENT rubric than `fresh`: the delta measures the ruler,
   *  not the repository, so neither the regression nor the promotion branch ran. */
  rulerChanged?: boolean;
}

/** Absolute report URL when a public base is configured, else the relative permalink. */
function reportUrl(fullName: string, headSha?: string | null): string {
  return `${publicBaseUrl()}${reportPermalink(fullName, headSha)}`;
}

/** Best-effort per-org sink lookup — alert routing must never throw into the scan path. */
async function orgWebhook(orgSlug?: string): Promise<string | null> {
  if (!orgSlug) return null;
  return getOrgAlertWebhook(orgSlug).catch(() => null);
}

/** What kind of sink the resolved URL is — for the history row, not for routing. */
function sinkKindOf(resolved: string | null): "webhook" | "email" | null {
  if (!resolved) return null;
  return emailSinkAddress(resolved) ? "email" : "webhook";
}

/**
 * Best-effort history row for an alert decision (delivered or suppressed). Keyed to the org when we
 * can resolve one — a repo-only scan with no org context records nothing (there is no drawer to show
 * it in). Never throws (recordAlertEvent's own contract).
 */
async function recordScanAlertEvent(
  opts: { orgId?: string; orgSlug?: string },
  input: AlertEventInput,
): Promise<void> {
  const org = opts.orgSlug ?? (opts.orgId ? { orgId: opts.orgId } : null);
  if (!org) return;
  await recordAlertEvent(org, input);
}

/**
 * The org's own "low balance" line, when it has opted in via the auto-recharge preference
 * (CreditsControl.autorecharge.ts / `/api/billing/autorecharge`), else the global default
 * (CREDITS_ALERT_THRESHOLD). Without this, the in-app warning (opt-in, per-org) and this Slack
 * push (global-only) disagreed about what "low" means (G1-40).
 *
 * Reads through the SAME accessor the preference's own route uses (`getAuditLog` keyed on
 * `AUTO_RECHARGE_ACTION`, the org's latest such entry) rather than any lower-level storage — the
 * preference is known to be mid-migration off the audit trail onto a real settings column (G1-39),
 * so going through this accessor (not straight to a table/column) is what keeps this call site
 * correct regardless of where the value ends up living.
 */
async function orgLowBalanceThreshold(orgSlug: string): Promise<number> {
  try {
    const page = await getAuditLog(orgSlug, { action: AUTO_RECHARGE_ACTION, limit: 1 }).catch(() => null);
    const entry = page?.entries[0];
    if (!entry) return creditsAlertThreshold();
    const pref = normalizeAutoRecharge(entry.meta);
    return pref.enabled ? pref.threshold : creditsAlertThreshold();
  } catch {
    return creditsAlertThreshold();
  }
}

/**
 * Compare `fresh` against `prev` and act on what moved. Records a `scan.regression` audit entry
 * whenever a regression is detected (so it's tracked even with no alert sink), and dispatches an
 * alert to the org's own webhook when `orgSlug` resolves one (multi-tenant routing), falling back
 * to the global ALERT_WEBHOOK_URL. Never throws — alerting must not fail the scan.
 *
 * A scan that did NOT regress but crossed a maturity band UPWARD takes the celebratory branch instead
 * (`promoted: true`) and pushes a distinctly-voiced promotion message through the same sink. The name
 * is kept for its three call sites — this is the single "did anything alert-worthy happen" entry point.
 */
export async function checkAndAlertRegression(
  prev: ScanReport | null,
  fresh: ScanReport,
  opts: { orgId?: string; orgSlug?: string; signal?: AbortSignal } = {},
): Promise<RegressionOutcome> {
  // MOONSHOT #1 — the CONTROL push runs first and INDEPENDENTLY of everything below it.
  //
  // It is deliberately not folded into the regression branch: a control flip is not a score movement,
  // it needs no `prev` report to be meaningful, and gating it on "did the score regress" would have
  // silenced the branch-protection alert on every repo whose score happened to hold. Its own
  // never-throwing wrapper, so a ledger read can never fail a scan or suppress the regression path.
  await alertControlTransitions(prev, fresh, opts).catch(() => {});

  if (!prev) return { regressed: false, verdict: null, dispatched: false };
  // THE RULER CHANGING IS NOT THE REPO MOVING. A rubric bump re-scores every repository, and the first
  // scan after it diffs an r(N) report against an r(N-1) one: the delta measures the ruler, and
  // alerting on it would page every org in the fleet at once for nothing any of them did. The outcomes
  // lane already keys every aggregate by rubricVersion for exactly this reason (lib/outcomes/aggregate.ts);
  // the alert lane must be as strict. A persisted `prev` carries its rubric (types.ts: populated on a
  // DB-reconstructed report); a live `fresh` may omit it and IS the current rubric. A legacy `prev` row
  // with no recorded rubric is UNKNOWN, not "changed" — it takes the ordinary path, never a silent skip.
  // Registry: conformance-checking/edition-stratified-conformance.
  const prevRubric = prev.engine?.rubricVersion;
  const freshRubric = fresh.engine?.rubricVersion ?? SCORING_RUBRIC_VERSION;
  if (prevRubric && prevRubric !== freshRubric) {
    return { regressed: false, verdict: null, dispatched: false, rulerChanged: true };
  }
  try {
    const diff = diffReports(prev, fresh);
    // Per-org sensitivity, falling back to DEFAULT_THRESHOLDS per field when unset (best-effort —
    // a failed lookup just uses the defaults; alerting must never throw into the scan path).
    const orgT = opts.orgSlug ? await getOrgAlertThresholds(opts.orgSlug).catch(() => null) : null;
    const verdict = detectRegression(diff, {
      overallDrop: orgT?.overallDrop ?? DEFAULT_THRESHOLDS.overallDrop,
      dimensionDrop: orgT?.dimensionDrop ?? DEFAULT_THRESHOLDS.dimensionDrop,
    });
    const fullName = `${fresh.repo.owner}/${fresh.repo.name}`;
    // Not a regression → the ONE other thing worth interrupting a human for: a promotion. Handled here,
    // inside the same never-throwing glue every fire site already calls (cron rescan, push webhook,
    // interactive finalize), so all three get the celebratory push with ZERO changes at the call sites.
    // No audit row: `scan.regression` is the regression trail, and the level change is already recorded
    // to Shared Org Memory by recordScanMemories (both directions, see memory/scan-feed.ts) — a
    // promotion needs a push, not a second record.
    if (!verdict.regressed) {
      const promotion = detectPromotion(diff);
      if (!promotion.promoted) return { regressed: false, verdict, dispatched: false };
      let dispatched = false;
      const webhookUrl = await orgWebhook(opts.orgSlug);
      const resolved = resolveAlertWebhook(webhookUrl);
      // SHARED claim pool with regressions, and the promotion CONSUMES it (see the cooldown block in
      // alerts.ts): a repo flapping across a band edge can't alternate 🎉/🔻 every scan.
      const claimed = resolved !== null && claimRegressionAlert(fullName);
      let message: AlertMessage | null = null;
      if (claimed) {
        message = buildPromotionMessage({ fullName, url: reportUrl(fullName, fresh.repo.headSha) }, diff, promotion);
        dispatched = await dispatchAlert(message, { signal: opts.signal, webhookUrl });
      }
      await recordScanAlertEvent(opts, {
        kind: "promotion",
        severity: "celebration",
        repoFullName: fullName,
        title: promotion.reasons[0]?.message ?? `${fullName} climbed a maturity level`,
        body: message?.text,
        delivered: dispatched,
        sinkKind: sinkKindOf(resolved),
        suppressedReason: !resolved ? "no-sink" : !claimed ? "cooldown" : dispatched ? null : "dispatch-failed",
      });
      return { regressed: false, verdict, dispatched, promoted: true };
    }

    // Best-effort audit — a flaky audit write must NOT suppress the regression alert below, so its
    // failure is swallowed (logged) rather than skipping straight to the outer catch (which would
    // return dispatched:false and silently drop a real alert).
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
    ).catch((err) => {
      console.error("[scan-alerts] audit write failed (alert still dispatched)", err instanceof Error ? err.message : err);
    });

    let dispatched = false;
    const webhookUrl = await orgWebhook(opts.orgSlug);
    const resolved = resolveAlertWebhook(webhookUrl);
    // Per-repo cooldown (fleet-alerts-digests #4): a repo flapping across the regression line would
    // otherwise re-alert on EVERY scan. Claim the cooldown slot (check-and-stamp) only once we have a
    // resolvable sink and are about to POST — a within-window repeat is throttled (still returns
    // regressed:true, since the verdict + audit row above are real; only the Slack push is suppressed).
    const claimed = resolved !== null && claimRegressionAlert(fullName);
    let message: AlertMessage | null = null;
    if (claimed) {
      message = buildRegressionMessage({ fullName, url: reportUrl(fullName, fresh.repo.headSha) }, diff, verdict);
      dispatched = await dispatchAlert(message, { signal: opts.signal, webhookUrl });
    }
    await recordScanAlertEvent(opts, {
      kind: "regression",
      severity: verdict.severity ?? "warning",
      repoFullName: fullName,
      title: verdict.reasons[0]?.message ?? `${fullName} regressed`,
      body: message?.text,
      delivered: dispatched,
      sinkKind: sinkKindOf(resolved),
      suppressedReason: !resolved ? "no-sink" : !claimed ? "cooldown" : dispatched ? null : "dispatch-failed",
    });

    // The SECURITY class (G7-03) fires here — the scan pipeline's post-scan diff, its documented
    // natural trigger (extra-alerts.ts deliberately does NOT dispatch it weekly). Condition: D9 fell
    // past the org's dimension-drop line but the generic regression push above headlined a DIFFERENT
    // dimension (or only the overall drop) — when D9 is already the headline, a second push about the
    // same slide would train the reader to ignore security pings. Own cooldown key so a D9 push isn't
    // starved by the generic claim the block above just consumed.
    const d9 = (diff.dimensions ?? []).find(
      (d) => d.id === "D9" && typeof d.delta === "number" && d.delta <= -(orgT?.dimensionDrop ?? DEFAULT_THRESHOLDS.dimensionDrop),
    );
    const d9Headlined = verdict.reasons.some((r) => r.code === "dimension-drop" && r.message.startsWith("D9 "));
    if (d9 && !d9Headlined) {
      let secDispatched = false;
      const secClaimed = resolved !== null && claimRegressionAlert(`${fullName}#security`);
      let secMessage: AlertMessage | null = null;
      const detail = `${d9.name} fell ${d9.delta} (${d9.before} → ${d9.after})`;
      if (secClaimed) {
        secMessage = buildSecurityAlertMessage({
          org: opts.orgSlug ?? fullName,
          url: reportUrl(fullName, fresh.repo.headSha),
          items: [{ repo: fullName, detail, kind: "gate" }],
        });
        secDispatched = await dispatchAlert(secMessage, { signal: opts.signal, webhookUrl });
      }
      await recordScanAlertEvent(opts, {
        kind: "security",
        severity: "critical",
        repoFullName: fullName,
        title: `Security standing dropped: ${detail}`,
        body: secMessage?.text,
        delivered: secDispatched,
        sinkKind: sinkKindOf(resolved),
        suppressedReason: !resolved ? "no-sink" : !secClaimed ? "cooldown" : secDispatched ? null : "dispatch-failed",
      });
    }
    return { regressed: true, verdict, dispatched };
  } catch (err) {
    console.error("[scan-alerts] regression check failed", err instanceof Error ? err.message : err);
    return { regressed: false, verdict: null, dispatched: false };
  }
}

/**
 * Fire a low-credits / depleted alert when a debit CROSSES the alert line
 * (CREDITS_ALERT_THRESHOLD, default 5, or zero). Sibling of checkAndAlertRegression: called after
 * each successful debit at the metered scan paths with the balance BEFORE and AFTER the debit —
 * the crossing is range-based (was above, now at/below), so it fires exactly once per descent with
 * no dedupe table and no reliance on debits being unit-sized. Routes to the org's own webhook when
 * one is set, falling back to the global ALERT_WEBHOOK_URL; a clean no-op when neither is
 * configured — without this push, depletion is only discoverable via the next 402, possibly weeks
 * after the scheduled fleet quietly stopped updating. Returns whether an alert was sent.
 */
export async function maybeAlertLowCredits(
  orgSlug: string,
  balanceBefore: number,
  balanceAfter: number,
  opts: { signal?: AbortSignal } = {},
): Promise<boolean> {
  try {
    const threshold = await orgLowBalanceThreshold(orgSlug);
    if (!isLowCreditsCrossing(balanceBefore, balanceAfter, threshold)) return false;
    const webhookUrl = await orgWebhook(orgSlug);
    const resolved = resolveAlertWebhook(webhookUrl);
    const base = publicBaseUrl();
    const message = buildLowCreditsMessage({
      org: orgSlug,
      balance: balanceAfter,
      threshold,
      url: base ? `${base}/org/${encodeURIComponent(orgSlug)}` : undefined,
    });
    const dispatched = resolved !== null && (await dispatchAlert(message, { signal: opts.signal, webhookUrl }));
    // History row even with no sink — depletion silently vanishing was exactly the gap.
    await recordAlertEvent(orgSlug, {
      kind: "low-credits",
      severity: balanceAfter <= 0 ? "critical" : "warning",
      title: balanceAfter <= 0 ? "Scan credits depleted" : `Scan credits low: ${balanceAfter} left (line: ${threshold})`,
      body: message.text,
      delivered: dispatched,
      sinkKind: sinkKindOf(resolved),
      suppressedReason: !resolved ? "no-sink" : dispatched ? null : "dispatch-failed",
    });
    return dispatched;
  } catch (err) {
    console.error("[scan-alerts] low-credits alert failed", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * MOONSHOT #1 — dispatch the control transitions the ledger recorded for this repo since the last
 * scan, as their own alert kind.
 *
 * Source of truth is the LEDGER, not a report diff. `ScanDiff` gains no governance field in this
 * lane on purpose: a control can flip between two scans (a webhook-triggered probe re-read it
 * minutes after the change) and a diff of two scan reports would miss it entirely, then report it
 * hours later against the wrong actor and the wrong time.
 *
 * Three rules the loop enforces, each of which exists because breaking it makes the alert worse than
 * no alert at all:
 *
 *   1. `control-unmeasurable` is RECORDED but NEVER dispatched to a sink. A token that lost a scope
 *      turns thirteen controls unreadable at once; paging on that would train a team to mute the
 *      channel the week before a control actually comes off.
 *   2. The cooldown key is per (repo, control) — `controlCooldownKey` — so a branch-protection flip
 *      is never starved by a score push that already consumed the repo's generic slot, and two
 *      different controls failing on one repo both get through.
 *   3. An `AlertEvent` row is written whether or not a sink existed, per the alert-history contract:
 *      the decision to raise is the fact worth keeping, and a missing sink is a `suppressedReason`,
 *      not a reason to forget.
 *
 * Returns whether anything reached a sink. Never throws.
 */
export async function alertControlTransitions(
  prev: ScanReport | null,
  fresh: ScanReport,
  opts: { orgId?: string; orgSlug?: string; signal?: AbortSignal } = {},
): Promise<boolean> {
  const orgSlug = opts.orgSlug;
  if (!orgSlug) return false;
  const fullName = `${fresh.repo.owner}/${fresh.repo.name}`;
  // Everything the ledger learned since the PREVIOUS scan — the window this scan is responsible for.
  // Without a previous scan the window is this scan's own instant, which yields only rows written by
  // this persist; baselines carry `transition: false` and are filtered out by the ledger itself, so a
  // first scan cannot fire thirteen "changes" the moment a repo is first observed.
  const since = prev?.scannedAt ?? fresh.scannedAt;
  const rows = (await listObservationsSince(orgSlug, since, { transitionsOnly: true }).catch(() => [])).filter(
    (r) => r.repoFullName === fullName,
  );
  const transitions = transitionsFromRows(rows);
  if (transitions.length === 0) return false;

  const items: ControlAlertItem[] = transitions.map((t) => ({
    repo: t.repoFullName,
    controlId: t.controlId,
    label: controlLabel(t.controlId),
    code: t.code,
    from: t.from,
    to: t.to,
    fromValue: t.fromValue,
    toValue: t.toValue,
    source: (rows.find((r) => r.controlId === t.controlId)?.source ?? "scan") as ControlAlertItem["source"],
    actorLogin: t.actorLogin,
  }));

  // Rule 1: only the loud codes are eligible for a sink. The quiet ones still get their history row
  // below, from the FULL item list.
  const dispatchable = items.filter((i) => isDispatchable(i.code));
  const webhookUrl = await orgWebhook(orgSlug);
  const resolved = resolveAlertWebhook(webhookUrl);
  // Rule 2: one claim per control, so a batch is throttled per-control rather than all-or-nothing.
  const claimed = resolved !== null ? dispatchable.filter((i) => claimRegressionAlert(controlCooldownKey(i.repo, i.controlId))) : [];

  let dispatched = false;
  let message: AlertMessage | null = null;
  if (claimed.length > 0) {
    message = buildControlAlertMessage({
      org: orgSlug,
      url: reportUrl(fullName, fresh.repo.headSha),
      items: claimed,
    });
    dispatched = await dispatchAlert(message, { signal: opts.signal, webhookUrl });
  }

  // Rule 3. Severity is computed over EVERY item, not just the dispatched ones — the history has to
  // say a control failed even in the week the push was throttled.
  const severity = controlAlertSeverity(items);
  const head = items[0]!;
  await recordScanAlertEvent(opts, {
    kind: "control",
    severity,
    repoFullName: fullName,
    title: `${controlLabel(head.controlId)} ${head.code === "control-failed" ? "failed" : head.code === "control-restored" ? "was restored" : "became unreadable"} on ${fullName}${items.length > 1 ? ` (+${items.length - 1} more)` : ""}`,
    body: message?.text,
    delivered: dispatched,
    sinkKind: sinkKindOf(resolved),
    // An `unmeasurable`-only batch is not "suppressed" by a missing sink or a cooldown — it was never
    // eligible. Saying `no-sink` there would blame the operator's configuration for a decision the
    // product made deliberately, so it records a plain undelivered row with no reason attached.
    suppressedReason: dispatched
      ? null
      : dispatchable.length === 0
        ? null
        : !resolved
          ? "no-sink"
          : claimed.length === 0
            ? "cooldown"
            : "dispatch-failed",
  });
  return dispatched;
}
