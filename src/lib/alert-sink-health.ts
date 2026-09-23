// SINK HEALTH FROM THE LEDGER ALONE. Pure: no DB, no fetch, safe in a client bundle.
//
// Every AlertEvent row already records whether its alert left and, if not, why. Nothing added that up,
// so an admin learned their Slack webhook had been deleted (or their mail provider started refusing
// the sink) the classic way: weeks later, by the silence. `sinkHealth` answers "is the sink working,
// since when has it not been, and what was lost" from those rows, newest first:
//
// - a DELIVERED row is a success and ends the walk (it bounds "since the last delivery");
// - `dispatch-failed` is the sink refusing an attempt: it counts toward the failing streak;
// - `no-sink` is "nothing resolved to send to": an unsent alert, but not the sink failing;
// - `cooldown`, an ineligible row (reason null, e.g. control-unmeasurable) and `sink-unreadable`
//   (OUR read failed, the sink was never tried) are not attempts: they neither count as a failure nor
//   break the streak.
//
// The state is decided by the newest row that IS an attempt outcome (delivered / dispatch-failed /
// no-sink), so "nothing was attempted" and "every attempt failed" never read the same.

/** Stored bodies are cut at this length (alert-events.ts). A body that reaches it may be truncated. */
export const ALERT_BODY_CAP = 2000;

export type SinkHealthState = "healthy" | "failing" | "unconfigured" | "no-attempts";

export interface SinkHealthRow {
  kind: string;
  delivered: boolean;
  suppressedReason: string | null;
  createdAt: string;
}

export interface SinkHealth {
  state: SinkHealthState;
  /** dispatch-failed rows since the last delivery (skipping rows that were not attempts). */
  consecutiveFailures: number;
  /** The OLDEST failure in that streak; null when there is none. */
  failingSince: string | null;
  lastDeliveredAt: string | null;
  /** Real alerts (not test sends) since the last delivery that failed or had no sink to go to. */
  unsent: number;
  /** False when the streak ran off the end of a full window: `failingSince` is then a lower bound. */
  exact: boolean;
}

/** Reasons that mean the alert was meant to go and did not. */
const UNSENT_REASONS = new Set(["dispatch-failed", "no-sink"]);

/**
 * Health of an org's sink from its AlertEvent rows, newest first. `windowFull` says the caller read
 * as many rows as it allows, so a walk that finds no delivery cannot claim to know where the streak began.
 */
export function sinkHealth(rows: readonly SinkHealthRow[], opts: { windowFull?: boolean } = {}): SinkHealth {
  let state: SinkHealthState | null = null;
  let consecutiveFailures = 0;
  let failingSince: string | null = null;
  let lastDeliveredAt: string | null = null;
  let unsent = 0;
  for (const r of rows) {
    if (r.delivered) {
      lastDeliveredAt = r.createdAt;
      state ??= "healthy";
      break;
    }
    const reason = r.suppressedReason ?? "";
    if (!UNSENT_REASONS.has(reason)) continue;
    if (r.kind !== "test") unsent++;
    if (reason === "dispatch-failed") {
      consecutiveFailures++;
      failingSince = r.createdAt;
      state ??= "failing";
    } else {
      state ??= "unconfigured";
    }
  }
  return {
    state: state ?? "no-attempts",
    consecutiveFailures,
    failingSince,
    lastDeliveredAt,
    unsent,
    exact: lastDeliveredAt !== null || !opts.windowFull,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The popover's one line of health. Null when there is nothing to say (no alert was ever attempted). */
export function sinkHealthLine(h: SinkHealth): string | null {
  const day = (iso: string | null) => (iso ?? "").slice(0, 10);
  switch (h.state) {
    case "failing":
      return `Failing since ${h.exact ? "" : "at least "}${day(h.failingSince)}. ${plural(h.unsent, "alert", "alerts")} not delivered.`;
    case "unconfigured":
      return `No alert sink resolved. ${plural(h.unsent, "alert", "alerts")} not sent.`;
    case "healthy":
      return `Sink healthy. Last delivered ${day(h.lastDeliveredAt)}.`;
    default:
      return null;
  }
}

/** The fields a resend decision reads: the row's outcome and the text it stored. */
export interface ResendCandidate {
  kind: string;
  delivered: boolean;
  suppressedReason: string | null;
  body: string;
}

/**
 * A row may be re-sent when its alert was meant to go and did not (dispatch-failed or no-sink), it is
 * a real alert (a test is re-sent with Send test), and its stored body is whole: an empty body has
 * nothing to send, and one that reached the storage cap may have been cut mid-sentence.
 */
export function isResendable(r: ResendCandidate): boolean {
  if (r.delivered || r.kind === "test") return false;
  if (!UNSENT_REASONS.has(r.suppressedReason ?? "")) return false;
  return r.body.trim().length > 0 && r.body.length < ALERT_BODY_CAP;
}

/** Wire shape of a history row: the body stays on the server, the verdict on it travels. */
export function toHistoryEvent<T extends ResendCandidate>(r: T): Omit<T, "body"> & { resendable: boolean } {
  const rest: Partial<T> = { ...r };
  delete rest.body;
  return { ...(rest as Omit<T, "body">), resendable: isResendable(r) };
}
