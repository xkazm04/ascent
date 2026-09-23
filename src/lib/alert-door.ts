// ONE ALERT DELIVERY DOOR: read the sink, resolve it, claim a slot, dispatch, record the history row.
//
// Every alert kind used to hand-write those five steps (scan-alerts.ts x5, conformance-alerts.ts, the
// digest cron, its extra alerts, the admin test send), and the copies diverged in the one way that
// mattered: the scan and conformance pushes swallowed a FAILED sink lookup into null, and
// `resolveAlertWebhook(null)` reads null as "this org has no sink of its own, use the operator's
// global ALERT_WEBHOOK_URL". A transient DB error therefore posted one tenant's regression, credit or
// control alert into the operator's channel, recorded it as delivered, and consumed the cooldown.
// The digest cron had found and fixed that for itself only (see its route).
//
// Here a thrown lookup is its own outcome, `sink-unreadable`: nothing is dispatched and the row says
// why. Only a genuine null (the row read fine, the column is empty) reaches the global fallback, so
// single-tenant deployments are unchanged. `src/lib/alert-door.contract.test.ts` pins that no other
// non-test file calls `dispatchAlert(` or `recordAlertEvent(`.
//
// Callers keep their detection and their message builders; the door owns the bookkeeping. It never
// throws: an alert must not be able to fail the scan, the CI ingest or the cron that raised it.

import { claimRegressionAlert, dispatchAlert, isAlertConfigured, sinkKindForOrg, type AlertMessage } from "@/lib/alerts";
import { getOrgAlertWebhook, recordAlertEvent, type AlertEventInput } from "@/lib/db";
import { claimOrgAuditOnce, releaseAuditClaim } from "@/lib/db/scans-audit";

export type AlertSuppressedReason = NonNullable<AlertEventInput["suppressedReason"]>;

/** The org's sink column as read: a value (possibly a genuine null) or a read that FAILED. */
export type SinkRead = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Read an org's sink without ever conflating "could not read" with "not configured". No org (a
 * repo-only scan) is a clean null: there is no tenant column to read, and the global sink is the
 * deployment's own.
 */
export async function readAlertSink(org: string | null | undefined): Promise<SinkRead> {
  if (!org) return { ok: true, value: null };
  try {
    return { ok: true, value: await getOrgAlertWebhook(org) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface AlertOutcomeState {
  eligible?: boolean;
  sinkUnreadable?: boolean;
  /** The resolved sink; `null` (or `false`) means none resolved. Omitted = not yet known. */
  resolved?: string | boolean | null;
  claimed?: boolean;
  dispatched?: boolean;
}

/**
 * THE suppressedReason table, stated once. Order is the order the door decides in: a delivered alert
 * has no reason; one that was never eligible (a control batch of only `control-unmeasurable`) has
 * none either, because blaming a sink or a cooldown for a decision the product made deliberately
 * would be false; then an unreadable sink, no sink, a lost claim, and finally a send that failed.
 */
export function alertOutcome(s: AlertOutcomeState): AlertSuppressedReason | null {
  if (s.dispatched) return null;
  if (s.eligible === false) return null;
  if (s.sinkUnreadable) return "sink-unreadable";
  if (s.resolved === null || s.resolved === false) return "no-sink";
  if (s.claimed === false) return "cooldown";
  return "dispatch-failed";
}

/**
 * How a send claims its slot. `cooldown`: the in-memory per-key pool (`claimRegressionAlert`), each
 * key claimed independently so a batch is throttled per key; the builder receives the keys it won.
 * `window`: the durable at-most-once audit claim for a period, released when delivery fails so the
 * next run retries; losing it means another run owns the window, and nothing is recorded.
 */
export type AlertClaim =
  | { cooldown: readonly string[] }
  | { window: { action: string; since: Date; meta: Record<string, unknown> } };

export interface DeliverAlertInput {
  /** Tenant slug: the sink lookup, the dispatch's org (mail footer), the window scope, the row. */
  org: string | null;
  /** Where the history row lands when there is no slug; no slug and no id records nothing. */
  recordTo?: { orgId: string } | null;
  /** A sink the caller already read (or a candidate it validated). Omitted: the door reads `org`'s. */
  sink?: SinkRead;
  kind: AlertEventInput["kind"];
  severity: AlertEventInput["severity"];
  title: string;
  repoFullName?: string | null;
  /** False = recorded, never dispatched, no reason attached. Default true. */
  eligible?: boolean;
  claim?: AlertClaim;
  /** Builds the message once the slot is won; receives the cooldown keys actually claimed. */
  build: (claimedKeys: readonly string[]) => AlertMessage;
  /** Row body when nothing was built (the alert still says what it would have said). */
  body?: string;
  signal?: AbortSignal;
  /** A failed window release is caught; this hears about it (default: logged). */
  onReleaseError?: (err: unknown) => void;
}

export interface AlertDelivery {
  delivered: boolean;
  /** False when the slot was lost (a cooldown, or a window another run owns). */
  claimed: boolean;
  outcome: AlertSuppressedReason | null;
  message: AlertMessage | null;
  recorded: boolean;
  /** Set when a window claim THREW (not lost): nothing was sent or recorded; the caller reports it. */
  claimError?: string;
}

/** Deliver one alert through the door. Never throws. */
export async function deliverAlert(input: DeliverAlertInput): Promise<AlertDelivery> {
  const eligible = input.eligible !== false;
  const sink = eligible ? (input.sink ?? (await readAlertSink(input.org))) : null;
  if (sink && !sink.ok) {
    console.warn("[alert-door] sink lookup failed, nothing dispatched", { org: input.org, kind: input.kind, error: sink.error });
  }
  const value = sink?.ok ? sink.value : null;
  const resolved = !!sink?.ok && isAlertConfigured(value);
  const sinkKind = resolved ? sinkKindForOrg(value) : null;

  let claimed = false;
  let claimedKeys: readonly string[] = [];
  let claimId: string | null = null;
  let message: AlertMessage | null = null;
  let delivered = false;
  if (resolved) {
    const claim = input.claim;
    if (claim && "window" in claim) {
      let won: { claimed: boolean; id: string | null } | null = null;
      try {
        won = input.org ? await claimOrgAuditOnce(claim.window.action, input.org, claim.window.since, claim.window.meta) : null;
      } catch (err) {
        // A claim that could not be TAKEN is not a window someone else owns: say so, send nothing.
        const claimError = err instanceof Error ? err.message : String(err);
        return { delivered: false, claimed: false, outcome: null, message: null, recorded: false, claimError };
      }
      if (!won?.claimed) return { delivered: false, claimed: false, outcome: "cooldown", message: null, recorded: false };
      claimed = true;
      claimId = won.id;
    } else if (claim) {
      claimedKeys = claim.cooldown.filter((key) => claimRegressionAlert(key));
      claimed = claimedKeys.length > 0;
    } else {
      claimed = true;
    }
    if (claimed) {
      try {
        message = input.build(claimedKeys);
        delivered = await dispatchAlert(message, {
          ...(input.signal ? { signal: input.signal } : {}),
          webhookUrl: value,
          org: input.org,
        });
      } catch (err) {
        console.error("[alert-door] dispatch error", err instanceof Error ? err.message : err);
        delivered = false;
      }
      if (!delivered && claimId) {
        await releaseAuditClaim(claimId).catch(
          input.onReleaseError ??
            ((err: unknown) => console.error("[alert-door] claim release failed", err instanceof Error ? err.message : err)),
        );
      }
    }
  }

  const outcome = alertOutcome({ eligible, sinkUnreadable: !!sink && !sink.ok, resolved: resolved ? value ?? true : null, claimed, dispatched: delivered });
  const target = input.org ?? input.recordTo ?? null;
  let recorded = false;
  if (target) {
    recorded = await recordAlertEvent(target, {
      kind: input.kind,
      severity: input.severity,
      repoFullName: input.repoFullName ?? null,
      title: input.title,
      body: message?.text ?? input.body,
      delivered,
      sinkKind,
      suppressedReason: outcome,
    }).catch(() => false);
  }
  return { delivered, claimed, outcome, message, recorded };
}
