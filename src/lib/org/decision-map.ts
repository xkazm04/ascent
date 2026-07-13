// Server-side view of an org's decisions for one module, keyed by the finding's itemKey.
//
// Two jobs, both about handing the UI something it can render without thinking:
//   1. Collapse a SNOOZE whose date has passed back to "open". Storage keeps the snooze (its rationale
//      and its author are history worth keeping); the view must not, or an expired snooze would hide a
//      finding forever — the exact bug a badge is supposed to prevent.
//   2. Return a plain serializable Record, not a Map, so it crosses the server→client boundary intact.

import { listDecisions, isResolved } from "@/lib/db";
import type { FindingModule } from "@/lib/org/findings";

export interface DecisionView {
  status: "open" | "accepted" | "dismissed" | "snoozed";
  rationale: string;
  decidedBy: string | null;
}

export type DecisionMap = Record<string, DecisionView>;

export async function decisionMap(orgSlug: string, module: FindingModule, now = new Date()): Promise<DecisionMap> {
  const rows = (await listDecisions(orgSlug, module).catch(() => null)) ?? [];
  const out: DecisionMap = {};
  for (const r of rows) {
    // An expired snooze reads as open, but anything else keeps the status it was given.
    const expiredSnooze = r.status === "snoozed" && !isResolved(r.status, r.snoozedUntil, now);
    out[r.itemKey] = {
      status: expiredSnooze ? "open" : (r.status as DecisionView["status"]),
      rationale: r.rationale,
      decidedBy: r.decidedBy,
    };
  }
  return out;
}

/** Whether a finding still awaits a call — the same predicate the rail badge counts on. */
export function isOpen(map: DecisionMap, itemKey: string): boolean {
  const d = map[itemKey];
  return !d || d.status === "open";
}
