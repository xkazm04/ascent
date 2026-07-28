"use client";

// Repo-tagging list, extracted from RepoSegmentsPanel.parts.tsx to keep that file under the 300-LOC
// ceiling (it crossed to 302 when the segment-count tooltip landed). Pure relocation — same JSX,
// className strings and handlers; all state still lives in RepoSegmentsPanel.

import { readableTextOn } from "@/lib/ui";
import type { SegmentItem, RepoItem } from "@/components/org/repositories/RepoSegmentsPanel";

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
