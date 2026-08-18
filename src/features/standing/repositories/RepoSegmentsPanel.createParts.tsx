"use client";

// AutoAddRow + CreateSegmentRow — split out of RepoSegmentsPanel.parts.tsx (which was itself over the
// 200-LOC cap, AGENTS.md) to keep both files under it. Same pure relocation as that file: no behavior
// change, all state still lives in RepoSegmentsPanel (via useRepoSegmentsPanel.ts).

import { PALETTE } from "./RepoSegmentsPanel.parts";
import type { SegmentItem } from "@/features/standing/repositories/RepoSegmentsPanel";

// Mirrors SEGMENT_NAME_MAX in src/lib/db/segments.ts — the server now REJECTS (400) longer names
// instead of silently truncating, so the inputs must stop the user at the same bound.
const NAME_MAX = 60;

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
