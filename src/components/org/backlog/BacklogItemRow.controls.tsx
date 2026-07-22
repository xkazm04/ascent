"use client";

import type { RecStatus } from "@/lib/types";
import type { BacklogItem } from "@/lib/db";
import { StatusSelect } from "@/components/org/shared/recStatusUi";

/**
 * The inline action bar of a backlog row — the status / owner / due controls plus the draft-PR,
 * promote, and history buttons. Extracted verbatim from BacklogItemRow to keep that file under the
 * 300-LOC cap (pure presentational relocation; the DOM, aria-labels, and data-focus-keys are
 * unchanged, so the row's a11y/focus tests still pass). `shown` is the optimistic `{...item,
 * ...override}` view the parent maintains during an in-flight edit.
 */
export function BacklogRowControls({
  item,
  shown,
  saving,
  options,
  practice,
  prBusy,
  promoteBusy,
  promoted,
  historyOpen,
  onPatchField,
  onOpenPr,
  onPromote,
  onToggleHistory,
}: {
  item: BacklogItem;
  shown: BacklogItem;
  saving: boolean;
  options: string[];
  /** The dimension's reusable practice, when one exists (only its label is rendered here). */
  practice?: { label: string };
  prBusy: boolean;
  promoteBusy: boolean;
  promoted: boolean;
  historyOpen: boolean;
  onPatchField: (patch: Partial<Pick<BacklogItem, "status" | "assigneeLogin" | "targetDate">>) => void;
  onOpenPr: () => void;
  onPromote: () => void;
  onToggleHistory: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
        status
        <StatusSelect
          value={shown.status as RecStatus}
          disabled={saving}
          onChange={(status) => onPatchField({ status })}
          aria-label="Status"
          data-focus-key={`${item.id}:status`}
        />
      </label>

      <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
        owner
        <select
          value={shown.assigneeLogin ?? ""}
          disabled={saving}
          onChange={(e) => onPatchField({ assigneeLogin: e.target.value || null })}
          aria-label="Owner"
          data-focus-key={`${item.id}:owner`}
          className="max-w-[10rem] rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
        >
          <option value="">Unassigned</option>
          {options.map((login) => (
            <option key={login} value={login}>
              @{login}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
        due
        <input
          type="date"
          value={shown.targetDate ?? ""}
          disabled={saving}
          onChange={(e) => onPatchField({ targetDate: e.target.value || null })}
          aria-label="Due date"
          data-focus-key={`${item.id}:due`}
          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
        />
      </label>

      {practice && (
        <button
          onClick={onOpenPr}
          disabled={prBusy || saving}
          title={`Open a draft PR seeding the "${practice.label}" starter into ${item.repo}`}
          className="rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1 font-mono text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
        >
          {prBusy ? "Opening PR…" : "Open draft PR →"}
        </button>
      )}

      <button
        onClick={onPromote}
        disabled={promoteBusy || promoted || saving}
        title="Roll this gap up into a tracked org initiative"
        className="rounded-md border border-slate-700 px-2.5 py-1 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50"
      >
        {promoted ? "✓ Initiative" : promoteBusy ? "Promoting…" : "Promote to initiative"}
      </button>

      <button
        onClick={onToggleHistory}
        className="ml-auto rounded-md border border-slate-700 px-2 py-1 font-mono text-sm text-slate-400 transition hover:text-white"
      >
        {historyOpen ? "Hide history" : "History"}
      </button>
      {saving && <span className="font-mono text-sm text-slate-500">saving…</span>}
    </div>
  );
}
