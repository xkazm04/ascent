"use client";

import { useEffect, useRef } from "react";
import { type MatchCount, type SortKey } from "./fleetMapDerive";
import { LEVEL_BANDS, SORTS } from "./FleetMap.constants";

/** True when `/` must stay a typed character rather than a search shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

// Triage controls for the fleet map (see showTriageControls for when they render).
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
  matchCount,
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
  /** Fleet-wide tally of repos passing the active filter (see countMatches). */
  matchCount: MatchCount;
  onClear: () => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);

  // `/` focuses Find a repo, matching the rest of the app. Mounted only while triage is shown.
  // Ignore when the keystroke is already going into a field — a slash in search or sort must stay a slash.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
      <input
        ref={searchRef}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find a repo…"
        aria-label="Filter repositories by name"
        aria-keyshortcuts="/"
        className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 type-body-sm text-slate-200 placeholder:text-slate-600"
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
              className={`rounded-md border px-2 py-0.5 type-mono-sm transition ${
                on ? "border-accent bg-accent/15 text-white" : "border-slate-700 text-slate-400 hover:text-white"
              }`}
            >
              {b === "unscanned" ? "—" : b}
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-1.5 type-mono-sm text-slate-400">
        <input type="checkbox" checked={watchedOnly} onChange={(e) => setWatchedOnly(e.target.checked)} className="accent-accent" />
        watched only
      </label>
      <label className="ml-auto flex items-center gap-1.5 type-mono-sm text-slate-500">
        sort
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 type-mono-sm text-slate-200"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {filterActive && (
        <>
          {/* Filtering DIMS stars rather than removing them, so a query that matches NOTHING renders a
              uniformly faded field — pixel-identical to a fleet that is simply all low-scoring. Saying
              the count out loud is the only thing that distinguishes them. Zero matches is called out
              in warn amber so it reads as a dead end, not as a result. aria-live announces the tally
              as the user types. */}
          <span
            role="status"
            aria-live="polite"
            className={`type-mono-sm tabular-nums ${
              matchCount.matched === 0 ? "text-amber-400/80" : "text-slate-400"
            }`}
          >
            {matchCount.matched === 0
              ? `no repos match · ${matchCount.total} charted`
              : `${matchCount.matched} of ${matchCount.total} match`}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="type-mono-sm text-slate-500 hover:text-white"
          >
            clear
          </button>
        </>
      )}
    </div>
  );
}
