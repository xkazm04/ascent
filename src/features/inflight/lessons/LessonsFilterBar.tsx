"use client";

// The Lessons ledger's filter chrome — the same FilterMenu dropdowns, search box and archive switch the
// Proposals ledger uses, over a lesson's own facets (namespace, kind).

import { FilterMenu, type FilterOption } from "@/features/standing/overview/FilterMenu";
import type { LoopLessonRow } from "@/features/inflight/live/cockpit/loopTypes";
import { emptyLessonFilters, lessonFiltersActive, lessonNamespace, type LessonFilters } from "./lessonsModel";

export function LessonsFilterBar({
  rows,
  filters,
  onChange,
  shown,
}: {
  rows: readonly LoopLessonRow[];
  filters: LessonFilters;
  onChange: (f: LessonFilters) => void;
  shown: number;
}) {
  const uniq = (xs: string[]): FilterOption[] => [...new Set(xs)].sort().map((v) => ({ value: v, label: v }));
  const toggle = (k: "namespaces" | "kinds", v: string) => {
    const next = new Set(filters[k]);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange({ ...filters, [k]: next });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterMenu
        label="Namespace"
        options={uniq(rows.map(lessonNamespace))}
        selected={filters.namespaces}
        onToggle={(v) => toggle("namespaces", v)}
        onClear={() => onChange({ ...filters, namespaces: new Set() })}
      />
      <FilterMenu
        label="Kind"
        options={uniq(rows.map((r) => r.kind))}
        selected={filters.kinds}
        onToggle={(v) => toggle("kinds", v)}
        onClear={() => onChange({ ...filters, kinds: new Set() })}
      />
      <input
        type="search"
        value={filters.query}
        onChange={(e) => onChange({ ...filters, query: e.target.value })}
        placeholder="Search lessons…"
        aria-label="Search lessons"
        className="focus-ring w-44 rounded-lg border border-divider bg-ink px-2.5 py-1.5 type-caption text-slate-200 placeholder:text-slate-600 focus:border-accent"
      />
      <button
        type="button"
        onClick={() => onChange({ ...filters, archive: !filters.archive })}
        aria-pressed={filters.archive}
        className={`focus-ring rounded-full border px-2.5 py-1 type-caption transition ${filters.archive ? "border-emerald-500/50 text-emerald-400" : "border-divider text-slate-400 hover:border-accent hover:text-white"}`}
      >
        {filters.archive ? "◂ review queue" : "settled archive"}
      </button>
      <span className="ml-auto type-caption text-slate-500">
        {shown} of {rows.length}
        {lessonFiltersActive(filters) && (
          <>
            {" · "}
            <button type="button" onClick={() => onChange(emptyLessonFilters())} className="focus-ring rounded text-accent hover:text-white">
              clear filters
            </button>
          </>
        )}
      </span>
    </div>
  );
}
