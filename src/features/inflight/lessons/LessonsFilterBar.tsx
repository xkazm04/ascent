"use client";

// The Lessons ledger's filter chrome, composition: the same facets and LessonFilters state as
// LessonsFilterBar (Namespace, Kind, search), with the review-queue / settled-archive switch as a kit Segmented.
import { FilterBar, FilterCount, FilterMenu, Input, Segmented, type FilterOption } from "@/components/kit";
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
    <FilterBar>
      <FilterMenu label="Namespace" options={uniq(rows.map(lessonNamespace))} selected={filters.namespaces} onToggle={(v) => toggle("namespaces", v)} onClear={() => onChange({ ...filters, namespaces: new Set() })} />
      <FilterMenu label="Kind" options={uniq(rows.map((r) => r.kind))} selected={filters.kinds} onToggle={(v) => toggle("kinds", v)} onClear={() => onChange({ ...filters, kinds: new Set() })} />
      <Input
        type="search"
        value={filters.query}
        onChange={(e) => onChange({ ...filters, query: e.target.value })}
        placeholder="Search lessons…"
        aria-label="Search lessons"
        className="w-48"
      />
      <Segmented
        label="Which lessons"
        value={filters.archive ? "archive" : "queue"}
        onSelect={(k) => onChange({ ...filters, archive: k === "archive" })}
        options={[
          { key: "queue", label: "Review queue" },
          { key: "archive", label: "Settled archive" },
        ]}
      />
      <FilterCount shown={shown} total={rows.length} active={lessonFiltersActive(filters)} onClear={() => onChange(emptyLessonFilters())} />
    </FilterBar>
  );
}
