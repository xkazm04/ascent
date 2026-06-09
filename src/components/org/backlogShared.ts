import type { RecStatus } from "@/lib/types";
import type { BacklogItem } from "@/lib/db";

export const STATUS_LABEL: Record<RecStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  dismissed: "Dismissed",
};

export const STATUS_ACCENT: Record<string, string> = {
  open: "#64748b",
  in_progress: "#eab308",
  done: "#22c55e",
  dismissed: "#475569",
};

export const EVENT_LABEL: Record<string, string> = {
  status: "Status",
  assignee: "Owner",
  target_date: "Due date",
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
