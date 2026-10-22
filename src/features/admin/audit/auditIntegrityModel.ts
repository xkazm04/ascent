// Pure mapping from a whole-trail integrity sweep (GET /api/audit/integrity) to what the strip above the
// audit table says. No React, no fetch: the hook owns the request, this owns the words.
//
// The honesty rules it encodes (data-model.md, audit integrity):
//   - a PARTIAL sweep (the 10,000-row cap was hit) is never shown as clean: it names the cap and says
//     the OLDEST matching rows were not checked, the same honesty as the CSV's -PARTIAL filename;
//   - a sweep where nothing could be checked (no signing secret) is "unverifiable", never "verified";
//   - `unsigned` is neutral information, never an alarm (AuditLogCells.tsx holds the same line);
//   - zero matching rows is "nothing to verify", not a vacuous "0 of 0 verified".

import type { AuditLogEntry } from "@/lib/db";

export interface AuditIntegritySummary {
  scanned: number;
  ok: number;
  unsigned: number;
  tampered: number;
  noSecret: number;
  truncated: boolean;
  /** At most 50 rows; `tampered` is the true count. */
  tamperedEntries: AuditLogEntry[];
  /** The row cap the walk ran under. */
  cap: number;
}

export type IntegrityStripKind =
  | "empty"
  | "verified"
  | "verified-with-unsigned"
  | "tampered"
  | "partial"
  | "unverifiable";

export interface IntegrityStripState {
  kind: IntegrityStripKind;
  tone: "ok" | "neutral" | "caution" | "alarm";
  headline: string;
  detail?: string;
  action?: "show-tampered";
  actionLabel?: string;
}

const n = (v: number) => v.toLocaleString("en-US");
const entries = (v: number) => `${n(v)} ${v === 1 ? "entry" : "entries"}`;

function counts(s: AuditIntegritySummary): string {
  const parts = [`${n(s.ok)} verified`];
  if (s.unsigned > 0) parts.push(`${n(s.unsigned)} unsigned`);
  if (s.noSecret > 0) parts.push(`${n(s.noSecret)} unverifiable`);
  if (s.tampered > 0) parts.push(`${n(s.tampered)} tampered`);
  return parts.join(", ");
}

function partialNote(s: AuditIntegritySummary): string {
  return (
    `This check stopped at the ${n(s.cap)}-entry cap, so the oldest matching entries were not checked. ` +
    "Narrow the filters (a date range, an action) to verify the rest."
  );
}

export function integrityStripState(s: AuditIntegritySummary): IntegrityStripState {
  if (s.scanned === 0 && !s.truncated) {
    return { kind: "empty", tone: "neutral", headline: "No entries match this filter, so there is nothing to verify." };
  }
  if (s.tampered > 0) {
    const shown = s.tamperedEntries.length;
    return {
      kind: "tampered",
      tone: "alarm",
      headline: `Checked ${entries(s.scanned)} matching this filter: ${counts(s)}`,
      detail:
        "Tampered entries do not match the signature recorded when they were written and may have been altered " +
        "directly in the database; do not file them as evidence." +
        (s.truncated ? ` ${partialNote(s)}` : ""),
      action: "show-tampered",
      actionLabel:
        shown < s.tampered ? `Show the first ${n(shown)} of ${n(s.tampered)} tampered` : `Show the ${n(s.tampered)} tampered`,
    };
  }
  if (s.noSecret > 0 && s.noSecret === s.scanned) {
    return {
      kind: "unverifiable",
      tone: "caution",
      headline: `${entries(s.scanned)} matching this filter could not be checked.`,
      detail: "This deployment has no audit signing secret, so no entry can be verified against its signature.",
    };
  }
  if (s.truncated) {
    return {
      kind: "partial",
      tone: "caution",
      headline: `Partial check of the newest ${entries(s.scanned)} matching this filter: ${counts(s)}`,
      detail: partialNote(s),
    };
  }
  if (s.unsigned > 0 || s.noSecret > 0) {
    return {
      kind: "verified-with-unsigned",
      tone: "neutral",
      headline: `Checked ${entries(s.scanned)} matching this filter: ${counts(s)}`,
      detail:
        "No entry was tampered with. Unsigned entries predate signing or were written by a path that skips it: " +
        "they are not evidence of tampering, and they are not verified either.",
    };
  }
  return {
    kind: "verified",
    tone: "ok",
    headline: `${n(s.ok)} of ${n(s.scanned)} verified`,
    detail: "Every entry matching this filter matches the signature recorded when it was written.",
  };
}

/** The applied filter query (org + filters) the CSV link was built from, minus `format=csv`. Deriving the
 *  sweep's query from the CSV href makes "the sweep checked the rows the CSV files" hold on the client too. */
export function appliedQueryFromCsvHref(csvHref: string): string {
  const qs = new URLSearchParams(csvHref.slice(csvHref.indexOf("?") + 1));
  qs.delete("format");
  return qs.toString();
}
