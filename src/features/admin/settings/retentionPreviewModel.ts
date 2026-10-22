// The retention preview as a per-ledger delta table: what the policy in force deletes tonight (`now`),
// what the edited draft deletes (`proposed`), and what the EDIT adds (`delta`). The route runs the
// same dry run under both policies, so the two columns come from one deleter, not two counters.
//
// Rows derive from PURGE_COUNTER_KEYS (plus the dry run's nullable digestsWouldWrite), never a hand
// list, so a new purge counter shows up here without an edit. Labels come from the erase dialog's
// table (erasePreviewViz), so both settings cards name a ledger the same way.
//
// Unknown is unknown: a counter the body omitted is omitted, a null count reads "unknown", and a
// missing proposed body makes the whole model unknown. Nothing here substitutes a 0.
//
// Pure: no React, no database.

import { PURGE_COUNTER_KEYS } from "@/lib/db/retention-counters";
import { blastLabel } from "./erasePreviewViz";

export type Measure = number | "unknown";

export interface PreviewRow {
  key: string;
  label: string;
  group: string;
  now: Measure;
  proposed: Measure;
  delta: Measure;
  state: "known" | "unknown";
  hint?: string;
}

export interface PreviewGroup {
  title: string;
  rows: PreviewRow[];
}

export interface RetentionPreviewModel {
  state: "ready" | "unknown";
  groups: PreviewGroup[];
}

const COMPACTION = "Compaction";
const DRY_RUN_FOLD_HINT = "A dry run folds nothing; see Digests (would write).";

/** Keys the erase table does not carry: the purge's own audit sweep and the compaction counters. */
const OWN_LABELS: Record<string, { label: string; group: string; hint?: string }> = {
  auditDeleted: { label: "Audit rows", group: "Audit" },
  digestsWritten: { label: "Digests written", group: COMPACTION, hint: DRY_RUN_FOLD_HINT },
  scansCompacted: { label: "Scans compacted", group: COMPACTION, hint: DRY_RUN_FOLD_HINT },
  digestsWouldWrite: { label: "Digests (would write)", group: COMPACTION },
};

/** The counters a preview row may carry, in purge order, then the dry run's nullable estimate. */
export const PREVIEW_KEYS: readonly string[] = [...PURGE_COUNTER_KEYS, "digestsWouldWrite"];

function labelOf(key: string): { label: string; group: string; hint?: string } {
  return OWN_LABELS[key] ?? blastLabel(key) ?? { label: key, group: "Other" };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function measure(src: Record<string, unknown> | null, key: string): Measure {
  const v = src?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : "unknown";
}

/** Whether the proposed body carried this key at all (a number, or the dry run's explicit null). */
function carried(src: Record<string, unknown>, key: string): boolean {
  const v = src[key];
  return typeof v === "number" || (v === null && key === "digestsWouldWrite");
}

export function retentionPreviewModel(baseline: unknown, proposed: unknown): RetentionPreviewModel {
  const p = asRecord(proposed);
  if (!p) return { state: "unknown", groups: [] };
  const b = asRecord(baseline);
  const groups: PreviewGroup[] = [];
  const byTitle = new Map<string, PreviewGroup>();
  for (const key of PREVIEW_KEYS) {
    if (!carried(p, key)) continue;
    const { label, group, hint } = labelOf(key);
    const now = measure(b, key);
    const next = measure(p, key);
    const known = now !== "unknown" && next !== "unknown";
    const row: PreviewRow = {
      key,
      label,
      group,
      now,
      proposed: next,
      delta: known ? (next as number) - (now as number) : "unknown",
      state: known ? "known" : "unknown",
      ...(hint ? { hint } : {}),
    };
    let g = byTitle.get(group);
    if (!g) {
      g = { title: group, rows: [] };
      byTitle.set(group, g);
      groups.push(g);
    }
    g.rows.push(row);
  }
  return { state: "ready", groups };
}

/** "+40", "-3", "0" or "unknown": the delta column's words. */
export function formatDelta(d: Measure): string {
  if (d === "unknown") return "unknown";
  return d > 0 ? `+${d}` : String(d);
}
