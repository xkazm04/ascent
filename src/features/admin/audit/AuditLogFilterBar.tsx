"use client";

// Filter form + CSV export + count for the audit-trail viewer. Extracted from AuditLogViewer.tsx
// (JSX region split, per docs/ORG-TABS-REFACTOR.md) to keep the viewer under the 200-LOC cap.

import { ACTION_FILTERS } from "./AuditLogCells";

export function AuditLogFilterBar({
  action,
  since,
  until,
  actor,
  loading,
  csvHref,
  entriesShown,
  onChangeAction,
  onChangeSince,
  onChangeUntil,
  onChangeActor,
  onSubmit,
}: {
  action: string;
  since: string;
  until: string;
  actor: string;
  loading: boolean;
  csvHref: string;
  entriesShown: number;
  onChangeAction: (v: string) => void;
  onChangeSince: (v: string) => void;
  onChangeUntil: (v: string) => void;
  onChangeActor: (v: string) => void;
  onSubmit: (e?: React.FormEvent) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      {/* A real <form> so Enter in the actor/date fields submits (keyboard users previously had no
          way to apply from a text input — the field appeared to "do nothing"). */}
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <label className="flex items-center gap-2 text-base text-slate-400">
          <span className="font-mono text-sm uppercase tracking-widest text-slate-500">Action</span>
          <select
            value={action}
            onChange={(e) => onChangeAction(e.target.value)}
            disabled={loading}
            aria-label="Filter by action"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
          >
            {ACTION_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          since
          <input type="date" value={since} onChange={(e) => onChangeSince(e.target.value)} aria-label="From date"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent" />
        </label>
        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          until
          <input type="date" value={until} onChange={(e) => onChangeUntil(e.target.value)} aria-label="To date"
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent" />
        </label>
        <input type="text" value={actor} onChange={(e) => onChangeActor(e.target.value)} placeholder="actor (login)" aria-label="Filter by actor"
          className="w-32 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-200 outline-none focus:border-accent" />
        <button type="submit" disabled={loading}
          className="rounded-md border border-slate-700 px-2.5 py-1 font-mono text-sm text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50">
          Apply
        </button>
      </form>
      <div className="flex items-center gap-3">
        <a href={csvHref} className="font-mono text-sm text-accent transition hover:text-white" title="Download all matching entries as CSV">
          Download CSV ↓
        </a>
        <span className="font-mono text-sm text-slate-500">{entriesShown} shown</span>
      </div>
    </div>
  );
}
