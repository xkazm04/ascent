"use client";

import { type SortKey } from "./fleetMapDerive";
import { LEVEL_BANDS, SORTS } from "./FleetMap.constants";

// Triage controls — usable once more than one org is charted, where the grid gets busy.
export function TriageControls({
  query,
  setQuery,
  levels,
  toggleLevel,
  watchedOnly,
  setWatchedOnly,
  sortKey,
  setSortKey,
  filterActive,
  onClear,
}: {
  query: string;
  setQuery: (v: string) => void;
  levels: Set<string>;
  toggleLevel: (band: string) => void;
  watchedOnly: boolean;
  setWatchedOnly: (v: boolean) => void;
  sortKey: SortKey;
  setSortKey: (v: SortKey) => void;
  filterActive: boolean;
  onClear: () => void;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a repo…"
        aria-label="Filter repositories by name"
        className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-sm text-slate-200 placeholder:text-slate-600"
      />
      <div className="flex items-center gap-1">
        {LEVEL_BANDS.map((b) => {
          const on = levels.has(b);
          return (
            <button
              key={b}
              type="button"
              onClick={() => toggleLevel(b)}
              aria-pressed={on}
              // The "unscanned" band renders as a bare "—"; without an explicit name a screen
              // reader announces only the punctuation. Give it a real accessible name (the glyph
              // stays decorative); L1–L5 already read fine but labelling them is harmless.
              aria-label={b === "unscanned" ? "unscanned" : b}
              className={`rounded-md border px-2 py-0.5 font-mono text-sm transition ${
                on ? "border-accent bg-accent/15 text-white" : "border-slate-700 text-slate-400 hover:text-white"
              }`}
            >
              {b === "unscanned" ? "—" : b}
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-1.5 font-mono text-sm text-slate-400">
        <input type="checkbox" checked={watchedOnly} onChange={(e) => setWatchedOnly(e.target.checked)} className="accent-accent" />
        watched only
      </label>
      <label className="ml-auto flex items-center gap-1.5 font-mono text-sm text-slate-500">
        sort
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-sm text-slate-200"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {filterActive && (
        <button
          type="button"
          onClick={onClear}
          className="font-mono text-sm text-slate-500 hover:text-white"
        >
          clear
        </button>
      )}
    </div>
  );
}
