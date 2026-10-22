// The retention receipt: did a purge remove anything from this org since the policy was saved?
//
// The purge writes a `retention.purged` row ONLY when it deleted something (retention.ts gates the
// audit write on sumDeleted > 0), so the absence of a newer row means "nothing removed", not "did
// not run". The copy says exactly that and never claims the job was skipped.
//
// Pure: no React, no database. Dates render as UTC calendar days so server and client agree.

import { PURGE_COUNTER_KEYS, sumDeleted, zeroCounters } from "@/lib/db/retention-counters";
import type { RetentionReceipt } from "@/lib/db/retention-receipt";

export type ReceiptState = "applied" | "not-since-save" | "never" | "unknown";

export interface ReceiptModel {
  state: ReceiptState;
  text: string;
  /** "Policy saved <day>", when a save is on record. */
  saved?: string;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** Rows the recorded counters say were deleted (folds excluded, the same sum the audit gate uses). */
export function removedRows(meta: Record<string, unknown>): number {
  const c = zeroCounters();
  for (const k of PURGE_COUNTER_KEYS) {
    const v = meta[k];
    if (typeof v === "number" && Number.isFinite(v)) c[k] = v;
  }
  return sumDeleted(c);
}

export function retentionReceiptModel(r: RetentionReceipt | null): ReceiptModel {
  if (!r) return { state: "unknown", text: "The purge history could not be read" };
  const saved = r.lastSave ? `Policy saved ${day(r.lastSave.at)}` : undefined;
  const withSaved = (m: Omit<ReceiptModel, "saved">): ReceiptModel => (saved ? { ...m, saved } : m);
  if (!r.lastPurge) {
    return withSaved({ state: "never", text: "No purge has removed anything from this organization yet" });
  }
  if (r.lastSave && Date.parse(r.lastPurge.at) <= Date.parse(r.lastSave.at)) {
    return withSaved({ state: "not-since-save", text: "No purge has removed anything since this policy was saved" });
  }
  const n = removedRows(r.lastPurge.meta);
  return withSaved({
    state: "applied",
    text: `Last purge removed ${n} ${n === 1 ? "row" : "rows"} on ${day(r.lastPurge.at)}`,
  });
}
