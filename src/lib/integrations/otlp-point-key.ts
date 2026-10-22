// The replay key of one OTLP delta datapoint. OTLP delivery is at-least-once (a timeout, a proxy
// 502/504 after the write committed, or our own 503 all make the exporter resend), and the push path
// stores delta counters by INCREMENTING, so a resend that is not recognized is added again.
//
// The usage-event-ingestion standard wants de-duplication keyed on an emitter-chosen transmission id.
// OTLP does not carry one (recorded as a deviation in docs/features/org-dashboard/org-intelligence.md),
// so the key is the closest emitter-minted identity there is: SERIES IDENTITY (source, metric name,
// resource attributes, datapoint attributes, each sorted) plus the DELTA INTERVAL (startTimeUnixNano,
// timeUnixNano). A delta series cannot legitimately report the same interval twice, so this is
// identity, not a hash of the value: two genuine increments of equal value in different intervals
// never collide, and the same interval re-serialized in any order or whitespace always does.

import { createHash } from "node:crypto";
import { attrMap, type OtlpDataPoint } from "./otlp-wire";

/** Canonical decimal form of a nanosecond timestamp, or "" when absent / zero / unreadable. */
function nanos(v: string | number | undefined): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? BigInt(Math.trunc(v)).toString() : "";
  const s = v.trim();
  if (!/^\d+$/.test(s)) return "";
  const canon = BigInt(s).toString();
  return canon === "0" ? "" : canon;
}

const sorted = (m: Record<string, string>): [string, string][] =>
  Object.entries(m).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * sha256 hex of (source, metric, sorted resource attributes, sorted datapoint attributes, interval).
 * Null when the datapoint carries no timestamp at all: such a point has no interval identity, so it is
 * ADMITTED unkeyed (and reported as such) rather than risk collapsing two real increments into one.
 */
export function otlpPointKey(
  source: string,
  resourceAttrs: Record<string, string>,
  metricName: string,
  dp: OtlpDataPoint,
): string | null {
  const start = nanos(dp.startTimeUnixNano);
  const end = nanos(dp.timeUnixNano);
  if (!start && !end) return null;
  const identity = JSON.stringify([source, metricName, sorted(resourceAttrs), sorted(attrMap(dp.attributes)), start, end]);
  return createHash("sha256").update(identity).digest("hex");
}

/** Admission predicate the parsers take: null admits everything (no store to consult). */
export type AdmitPoint = ((key: string) => boolean) | null;
