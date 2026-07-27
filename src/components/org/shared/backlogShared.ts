import type { RecStatus } from "@/lib/types";
import type { BacklogItem } from "@/lib/db";

/**
 * Result of a backlog PATCH + its follow-up refresh, returned from BacklogPanel to a row so the row can
 * decide whether to keep or drop its optimistic override. The two flags are distinct because a PATCH can
 * succeed while its refresh is swallowed (503/blip) — in which case the row must KEEP the optimistic
 * value (the server already has it) rather than snap back to the stale pre-edit value (backlog #2).
 */
export interface PatchOutcome {
  /** The PATCH write itself succeeded (2xx). */
  patched: boolean;
  /** A refresh landed a fresh authoritative snapshot after the write (or a 409 reconcile). */
  refreshed: boolean;
}

export const STATUS_LABEL: Record<RecStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  dismissed: "Dismissed",
};

// Typed against RecStatus (not string) so a newly-added status can't silently index to an
// `undefined` border colour — it becomes a compile error here instead (backlog-management 07-16 #4).
export const STATUS_ACCENT: Record<RecStatus, string> = {
  open: "#64748b",
  in_progress: "#eab308",
  done: "#22c55e",
  dismissed: "#475569",
};

/** STATUS_ACCENT lookup for loosely-typed (string) statuses — falls back to the `open` accent. */
export function statusAccent(status: string): string {
  return STATUS_ACCENT[status as RecStatus] ?? STATUS_ACCENT.open;
}

/**
 * The single "due soon" window (in rolling days) behind the `this_week` due bucket, the "Due ≤ Nd"
 * summary tile, and its backend count — previously three independent literal 7s across two layers,
 * where changing one (e.g. to a sprint length) silently desynced the tile from the bucket it
 * summarizes (backlog-management 07-16 #4). Client-safe; the DB layer imports it from here.
 */
export const DUE_SOON_DAYS = 7;

/** The overdue accent shared by the row's left border, the Overdue tile, and the due chip family. */
export const OVERDUE_ACCENT = "#f97316";

export const EVENT_LABEL: Record<string, string> = {
  status: "Status",
  assignee: "Owner",
  target_date: "Due date",
  note: "Note",
};

/** Render a stored event value for display — status ids become labels; null reads as a dash. */
export function eventValue(kind: string, v: string | null): string {
  if (v == null) return "—";
  if (kind === "status") return STATUS_LABEL[v as RecStatus] ?? v;
  return v;
}

/** "in 3 days" / "2 days ago" / "today" for a due date relative to its computed day offset. */
export function dueLabel(item: BacklogItem): string | null {
  if (item.dueInDays == null) return null;
  const d = item.dueInDays;
  if (d === 0) return "due today";
  if (d < 0) return `${-d} day${d === -1 ? "" : "s"} overdue`;
  return `due in ${d} day${d === 1 ? "" : "s"}`;
}
