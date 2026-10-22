"use client";

// The Lessons ledger, Prism composition. Same props and the same useLessonsView as LessonsWorklist; the ledger
// is the kit-built DecisionLedgerV2 and the status travels as a glyph and a word, not a coloured pill.
import { timeAgo } from "@/lib/ui";
import type { LoopLessonRow } from "@/features/inflight/live/cockpit/loopTypes";
import { DecisionLedgerV2, type LedgerAction, type LedgerColumn } from "@/features/inflight/proposals/DecisionLedger.v2";
import { LessonsFilterBarV2 } from "./LessonsFilterBar.v2";
import { isPendingLesson, lessonNamespace } from "./lessonsModel";
import { useLessonsView } from "./useLessonsView";

const STATUS: Record<string, string> = { pending: "◐ awaiting review", kept: "✓ kept", discarded: "– discarded" };
const INLINE = "focus-ring type-caption text-slate-300 hover:text-white disabled:opacity-50";

export function LessonsWorklistV2({ org, initial }: { org: string; initial: LoopLessonRow[] }) {
  const { lessons, filters, setFilters, selected, setSelected, busy, error, shown, settle } = useLessonsView({ org, initial });

  const columns: LedgerColumn<LoopLessonRow>[] = [
    { key: "namespace", header: "Namespace", cell: (r) => <span className="whitespace-nowrap type-caption text-slate-300">{lessonNamespace(r)}</span> },
    { key: "kind", header: "Kind", cell: (r) => <span className="whitespace-nowrap type-caption text-slate-300">{r.kind}</span> },
    {
      key: "lesson",
      header: "Lesson",
      cell: (r, { open, toggleOpen }) => (
        <button type="button" onClick={toggleOpen} aria-expanded={open} className={`focus-ring text-left text-white hover:text-accent ${open ? "" : "line-clamp-2"}`}>
          {r.content}
        </button>
      ),
    },
    { key: "status", header: "Status", cell: (r) => <span className="whitespace-nowrap type-caption text-slate-200">{STATUS[r.status] ?? STATUS.pending}</span> },
    { key: "age", header: "Age", align: "right", cell: (r) => <span className="type-caption text-slate-400">{timeAgo(r.createdAt)}</span> },
    {
      key: "decide",
      header: <span className="sr-only">Decide</span>,
      align: "right",
      cell: (r) =>
        isPendingLesson(r) ? (
          <span className="inline-flex items-center gap-4">
            <button type="button" disabled={busy !== null} onClick={() => void settle([r], "keep")} className={INLINE}>
              Keep
            </button>
            <button type="button" disabled={busy !== null} onClick={() => void settle([r], "discard")} className={INLINE}>
              Discard
            </button>
          </span>
        ) : null,
    },
  ];

  const actions: LedgerAction<LoopLessonRow>[] = [
    { key: "discard", label: "Discard", busyLabel: "Discarding…", tone: "neutral", run: (picked) => settle(picked, "discard") },
    { key: "keep", label: "Keep", busyLabel: "Keeping…", tone: "primary", run: (picked) => settle(picked, "keep") },
  ];

  return (
    <div className="space-y-5">
      <p className="max-w-[60ch] type-body-sm text-slate-300">
        Written by a loop agent, and <strong className="font-semibold text-white">not in memory until you keep one</strong>. Keeping runs the same
        duplicate check any memory write does.
      </p>
      <LessonsFilterBarV2 rows={lessons} filters={filters} onChange={setFilters} shown={shown.length} />
      <DecisionLedgerV2
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
          <p className="type-caption text-slate-400">
            {r.laneId ? `from lane ${r.laneId.slice(0, 8)} · ` : ""}
            {r.reviewedBy ? `settled by ${r.reviewedBy} ${r.reviewedAt ? timeAgo(r.reviewedAt) : ""} · ` : ""}
            {r.promotedMemoryId ? `memory ${r.promotedMemoryId} · ` : ""}id {r.id}
          </p>
        )}
        actions={actions}
        empty={<p className="type-body-sm text-slate-400">{filters.archive ? "Nothing has been settled yet." : "No lessons are waiting for review."}</p>}
      />
      {error && (
        <p role="alert" className="type-caption text-slate-100">
          ! {error}
        </p>
      )}
    </div>
  );
}
