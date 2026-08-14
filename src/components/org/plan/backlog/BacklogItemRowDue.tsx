"use client";

import type { BacklogItem } from "@/lib/db";
import { dueLabel } from "@/components/org/shared/backlogShared";

/**
 * The row's due-date chip (G6-28).
 *
 * Previously the chip rendered only when a due date existed, so an undated item showed *nothing* in
 * the slot — indistinguishable from a chip that failed to render, and offering no hint that a due date
 * is even settable. Now "no due date" is a first-class, dashed-outline state that says so and, being a
 * button, focuses this row's own due control so the date can be added in one click. That mirrors the
 * "Unassigned" treatment the owner control already gets.
 *
 * Date handling follows the canonical org time-zone policy (`src/lib/org/timezone.ts`, note 5): the
 * relative label comes from the server-computed `dueInDays` (bucketed in the canonical zone), and the
 * absolute date is shown as the stored `yyyy-mm-dd` LITERAL — never re-parsed into an instant here,
 * which is exactly how a browser-local re-truncation would show the previous day.
 */
export function DueChip({ item }: { item: BacklogItem }) {
  const due = dueLabel(item);

  if (!due) {
    return (
      <button
        type="button"
        // The row's due <input> carries this stable key (the same one the panel uses for focus restore).
        onClick={() => document.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(`${item.id}:due`)}"]`)?.focus()}
        title="No due date set. Click to set one"
        className="focus-ring shrink-0 rounded-md border border-dashed border-slate-700 px-2 py-0.5 font-mono text-sm text-slate-500 transition hover:border-slate-500 hover:text-slate-300"
      >
        no due date
      </button>
    );
  }

  return (
    <span
      title={item.targetDate ? `Due ${item.targetDate}` : undefined}
      className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-sm ${item.overdue ? "bg-orange-500/10 text-orange-300" : "text-slate-400"}`}
    >
      {due}
    </span>
  );
}
