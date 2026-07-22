"use client";

// Presentational sub-sections of RepoSegmentsPanel, extracted verbatim to keep the orchestrator
// (RepoSegmentsPanel.tsx) under the 300-LOC ceiling. These are pure relocation: the same JSX,
// className strings, comments, and handlers — just parameterized by props the panel already had in
// scope. No behavior change; all state still lives in RepoSegmentsPanel.

import { readableTextOn } from "@/lib/ui";
import type { SegmentItem, RepoItem } from "@/components/org/repositories/RepoSegmentsPanel";

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
          <span className="font-mono text-sm text-slate-500">{s.repoCount}</span>
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
      {segments.length === 0 && <span className="text-sm text-slate-500">No segments yet — create one to start tagging.</span>}
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

// Auto-add by language — bulk-tag every repo of a language into a segment in one call.
export function AutoAddRow({
  languages,
  segments,
  autoLang,
  setAutoLang,
  autoSeg,
  setAutoSeg,
  autoBusy,
  autoAdd,
}: {
  languages: [string, number][];
  segments: SegmentItem[];
  autoLang: string;
  setAutoLang: (v: string) => void;
  autoSeg: string;
  setAutoSeg: (v: string) => void;
  autoBusy: boolean;
  autoAdd: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-3">
      <span className="font-mono text-sm uppercase tracking-widest text-slate-500">Auto-add</span>
      <select
        value={autoLang}
        onChange={(e) => setAutoLang(e.target.value)}
        aria-label="Auto-add language"
        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
      >
        <option value="">language…</option>
        {languages.map(([lang, n]) => (
          <option key={lang} value={lang}>
            {lang} ({n})
          </option>
        ))}
      </select>
      <span className="font-mono text-sm text-slate-500">→</span>
      <select
        value={autoSeg}
        onChange={(e) => setAutoSeg(e.target.value)}
        aria-label="Auto-add target segment"
        className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
      >
        <option value="">segment…</option>
        {segments.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        onClick={autoAdd}
        disabled={autoBusy || !autoLang || !autoSeg}
        className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:border-accent hover:text-white disabled:opacity-50"
      >
        {autoBusy ? "Adding…" : "Add all"}
      </button>
    </div>
  );
}

// Create-segment row — palette swatches + name input + submit.
export function CreateSegmentRow({
  color,
  setColor,
  name,
  setName,
  createSegment,
  busy,
}: {
  color: string;
  setColor: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  createSegment: () => void;
  busy: boolean;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
      <div className="flex items-center gap-1">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Color ${c}`}
            onClick={() => setColor(c)}
            className={`h-5 w-5 rounded-full border transition ${color === c ? "border-white" : "border-transparent"}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && createSegment()}
        maxLength={NAME_MAX}
        placeholder="New segment name"
        className="min-w-[10rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
      />
      <button
        onClick={createSegment}
        disabled={busy || !name.trim()}
        className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add segment"}
      </button>
    </div>
  );
}

// Per-repo tagging — filterable repo list, each row toggling segment chips.
export function RepoTaggingList({
  segments,
  visibleRepos,
  membership,
  filter,
  setFilter,
  toggle,
  repos,
}: {
  segments: SegmentItem[];
  visibleRepos: RepoItem[];
  membership: Record<string, string[]>;
  filter: string;
  setFilter: (v: string) => void;
  toggle: (fullName: string, segId: string) => void;
  repos: RepoItem[];
}) {
  return (
    <div className="mt-6 border-t border-slate-800 pt-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-mono text-sm uppercase tracking-widest text-slate-400">Tag repositories</h3>
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter repos…"
          className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-sm text-slate-200 placeholder:text-slate-600"
        />
      </div>
      <div className="mt-3 max-h-96 space-y-1.5 overflow-y-auto pr-1">
        {visibleRepos.map((r) => {
          const ids = new Set(membership[r.fullName] ?? []);
          return (
            <div key={r.fullName} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-slate-300" title={r.fullName}>
                {r.fullName}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                {segments.map((s) => {
                  const on = ids.has(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggle(r.fullName, s.id)}
                      aria-pressed={on}
                      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-sm transition"
                      style={
                        on
                          ? // repositories-segments #5: the API accepts ANY valid hex (not just the
                            // light in-app palette), so pick the label ink by luminance — fixed
                            // near-black on e.g. #0b1220 was an unreadable chip.
                            { backgroundColor: s.color, borderColor: s.color, color: readableTextOn(s.color) }
                          : { borderColor: "#334155", color: "#94a3b8" }
                      }
                    >
                      {!on && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />}
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {visibleRepos.length === 0 && <p className="text-sm text-slate-500">No repos match “{filter}”.</p>}
      </div>
      <p className="mt-2 font-mono text-sm text-slate-600">{segments.length} segment{segments.length === 1 ? "" : "s"} · {repos.length} repos</p>
    </div>
  );
}
