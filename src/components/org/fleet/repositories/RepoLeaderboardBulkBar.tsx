"use client";

// The sticky bulk-tag action bar beneath RepoLeaderboard — extracted so that file stays under the
// 200-LOC cap (AGENTS.md).

import type { SegmentItem } from "./useRepoLeaderboard";

export function RepoLeaderboardBulkBar({
  count,
  segments,
  target,
  setTarget,
  busy,
  error,
  onAdd,
  onClear,
}: {
  count: number;
  segments: SegmentItem[];
  target: string;
  setTarget: (v: string) => void;
  busy: boolean;
  error: string | null;
  onAdd: () => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-10 mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-accent/40 bg-slate-900/95 px-4 py-3 shadow-lg backdrop-blur">
      <span className="font-mono text-sm text-white">{count} selected</span>
      <span className="font-mono text-sm text-slate-500">→ add to</span>
      <select
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        aria-label="Add selected repos to segment"
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
        onClick={onAdd}
        disabled={busy || !target}
        className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50"
      >
        {busy ? "Adding…" : "Add"}
      </button>
      <button onClick={onClear} className="rounded-lg px-2 py-1.5 text-sm text-slate-400 hover:text-white">
        Clear
      </button>
      {error && <span className="font-mono text-sm text-orange-300">{error}</span>}
    </div>
  );
}
