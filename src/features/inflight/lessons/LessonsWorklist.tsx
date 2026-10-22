"use client";

// The Lessons ledger — the loop's lesson candidates in the shared DecisionTable, with the Proposals
// ledger's UX: filter, tick a batch, Keep N / Discard N from the sticky bar, or decide one row inline.
//
// The notice above the table is the point of the surface, carried over from the cockpit panel this
// replaced: a row here is NOT in Org Memory. The companion, the lane brief and every consolidation
// pass read memory as truth, so Keep promotes through the same memory door a person's own write uses,
// and Discard is soft. A settled row leaves the review queue for the settled archive.

import { InlineEmpty } from "@/components/org/shared/ui";
import { DecisionTable, type DecisionAction, type DecisionColumn } from "@/components/org/shared/DecisionTable";
import { timeAgo } from "@/lib/ui";
import type { LoopLessonRow } from "@/features/inflight/live/cockpit/loopTypes";
import { LessonsFilterBar } from "./LessonsFilterBar";
import { isPendingLesson, lessonNamespace } from "./lessonsModel";
import { useLessonsView } from "./useLessonsView";

const STATUS_CLASS: Record<string, string> = {
  pending: "border-divider text-slate-400",
  kept: "border-emerald-500/50 text-emerald-400",
  discarded: "border-slate-700 text-slate-500 line-through",
};

export function LessonsWorklist({ org, initial }: { org: string; initial: LoopLessonRow[] }) {
  const { lessons, filters, setFilters, selected, setSelected, busy, error, shown, settle } = useLessonsView({ org, initial });

  const columns: DecisionColumn<LoopLessonRow>[] = [
    { key: "namespace", header: "Namespace", cell: (r) => <span className="whitespace-nowrap type-caption text-slate-400">{lessonNamespace(r)}</span> },
    { key: "kind", header: "Kind", cell: (r) => <span className="whitespace-nowrap type-caption text-slate-400">{r.kind}</span> },
    {
      key: "lesson",
      header: "Lesson",
      cell: (r, { open, toggleOpen }) => (
        <button type="button" onClick={toggleOpen} aria-expanded={open} className={`focus-ring text-left type-body-sm text-slate-100 hover:text-white ${open ? "" : "line-clamp-2"}`}>
          {r.content}
        </button>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-px type-caption ${STATUS_CLASS[r.status] ?? STATUS_CLASS.pending}`}>
          {r.status === "pending" ? "awaiting review" : r.status}
        </span>
      ),
    },
    { key: "age", header: "Age", align: "right", cell: (r) => <span className="type-caption text-slate-500">{timeAgo(r.createdAt)}</span> },
    {
      key: "decide",
      header: <span className="sr-only">Decide</span>,
      align: "right",
      cell: (r) =>
        isPendingLesson(r) ? (
          <span className="inline-flex items-center gap-3 type-caption">
            <button type="button" disabled={busy !== null} onClick={() => void settle([r], "keep")} className="focus-ring rounded text-accent hover:text-accent-soft disabled:opacity-50">
              Keep
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void settle([r], "discard")} className="focus-ring rounded text-slate-500 hover:text-slate-300 disabled:opacity-50">
              Discard
            </button>
          </span>
        ) : null,
    },
  ];

  const actions: DecisionAction<LoopLessonRow>[] = [
    { key: "discard", label: "Discard", busyLabel: "Discarding…", tone: "neutral", run: (picked) => settle(picked, "discard") },
    { key: "keep", label: "Keep", busyLabel: "Keeping…", tone: "primary", run: (picked) => settle(picked, "keep") },
  ];

  return (
    <div className="space-y-4">
      <p className="type-caption leading-relaxed text-slate-500">
        Written by a loop agent, and <strong className="font-semibold text-slate-400">not in memory until you keep one</strong>. Keeping runs the
        same duplicate check any memory write does.
      </p>
      <LessonsFilterBar rows={lessons} filters={filters} onChange={setFilters} shown={shown.length} />
      <DecisionTable
        caption="Lesson candidates"
        rows={shown}
        allRows={lessons}
        rowId={(r) => r.id}
        rowLabel={(r) => r.content.slice(0, 60)}
        columns={columns}
        selected={selected}
        onSelectedChange={setSelected}
        isSelectable={isPendingLesson}
        isMuted={(r) => !isPendingLesson(r)}
        renderDetail={(r) => (
          <p className="type-caption text-slate-600">
            {r.laneId ? `from lane ${r.laneId.slice(0, 8)} · ` : ""}
            {r.reviewedBy ? `settled by ${r.reviewedBy} ${r.reviewedAt ? timeAgo(r.reviewedAt) : ""} · ` : ""}
            {r.promotedMemoryId ? `memory ${r.promotedMemoryId} · ` : ""}id {r.id}
          </p>
        )}
        actions={actions}
        empty={<InlineEmpty>{filters.archive ? "Nothing has been settled yet." : "No lessons are waiting for review."}</InlineEmpty>}
      />
      {error && <p className="type-caption text-danger">{error}</p>}
    </div>
  );
}
