"use client";

// Presentational sub-sections of RepoSegmentsPanel, extracted verbatim to keep the orchestrator
// (RepoSegmentsPanel.tsx) under the 300-LOC ceiling. These are pure relocation: the same JSX,
// className strings, comments, and handlers — just parameterized by props the panel already had in
// scope. No behavior change; all state still lives in RepoSegmentsPanel.

import { readableTextOn } from "@/lib/ui";
import type { SegmentItem, RepoItem } from "@/features/standing/repositories/RepoSegmentsPanel";

// Mirrors SEGMENT_NAME_MAX in src/lib/db/segments.ts — the server now REJECTS (400) longer names
// instead of silently truncating, so the inputs must stop the user at the same bound.
const NAME_MAX = 60;

export const PALETTE = ["#3b9eff", "#84cc16", "#f97316", "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#64748b"];

// Existing segments row + create — the chip list with double-click rename, ✎ editor, and × delete.
// The × only REQUESTS deletion (opens a confirm in the panel) — it sits one pixel from the ✎ edit
// button and a straight DELETE here wiped the segment and every RepoSegment tag on a single misclick.
export function SegmentChips({
  segments,
  startEdit,
  onDeleteRequest,
}: {
  segments: SegmentItem[];
  startEdit: (s: SegmentItem) => void;
  onDeleteRequest: (id: string) => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {segments.map((s) => (
        <span key={s.id} className="group inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/60 py-1 pl-2.5 pr-1.5 text-sm">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
          {/* Double-click the name to rename (also reachable via the ✎ editor below). */}
          <span className="text-slate-200" onDoubleClick={() => startEdit(s)} title="Double-click to rename">
            {s.name}
          </span>
          {/* G4-08: this is the TAGGED count (every repo ever added to the segment, watched or not,
              scanned or not) — a different universe than the "N/M scanned" count on the segment
              maturity cards below, which only counts watched-or-scanned repos. The title spells that
              out so the two counts don't read as disagreeing. */}
          <span className="font-mono text-sm text-slate-500" title={`${s.repoCount} repo${s.repoCount === 1 ? "" : "s"} tagged`}>
            {s.repoCount}
          </span>
          <button
            type="button"
            onClick={() => startEdit(s)}
            aria-label={`Edit ${s.name} segment`}
            className="ml-0.5 rounded-full px-1 text-slate-600 transition hover:bg-slate-800 hover:text-accent"
          >
            ✎
          </button>
          <button
            type="button"
            onClick={() => onDeleteRequest(s.id)}
            aria-label={`Delete ${s.name} segment`}
            className="rounded-full px-1 text-slate-600 transition hover:bg-slate-800 hover:text-orange-300"
          >
            ×
          </button>
        </span>
      ))}
      {segments.length === 0 && <span className="text-sm text-slate-500">No segments yet. Create one to start tagging.</span>}
    </div>
  );
}

// Inline editor — rename + recolor the selected segment (PATCH /api/org/segments/:id).
export function SegmentEditor({
  editingId,
  editName,
  setEditName,
  editColor,
  setEditColor,
  saveEdit,
  setEditingId,
}: {
  editingId: string;
  editName: string;
  setEditName: (v: string) => void;
  editColor: string;
  setEditColor: (v: string) => void;
  saveEdit: (id: string) => void;
  setEditingId: (v: string | null) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/40 p-3">
      <input
        value={editName}
        onChange={(e) => setEditName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") saveEdit(editingId);
          if (e.key === "Escape") setEditingId(null);
        }}
        maxLength={NAME_MAX}
        autoFocus
        aria-label="Segment name"
        className="min-w-[10rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200"
      />
      <div className="flex items-center gap-1">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Recolor ${c}`}
            onClick={() => setEditColor(c)}
            className={`h-5 w-5 rounded-full border transition ${editColor === c ? "border-white" : "border-transparent"}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <button onClick={() => saveEdit(editingId)} className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20">
        Save
      </button>
      <button onClick={() => setEditingId(null)} className="rounded-lg px-2 py-1.5 text-sm text-slate-400 hover:text-white">
        Cancel
      </button>
    </div>
  );
}

// AutoAddRow and CreateSegmentRow live in RepoSegmentsPanel.createParts.tsx — this file was itself
// over the 200-LOC cap (AGENTS.md), so the two lower rows moved to a sibling.
export { AutoAddRow, CreateSegmentRow } from "./RepoSegmentsPanel.createParts";
