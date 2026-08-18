"use client";

// Filter chrome shared by the variants: Repo · Dimension · Impact · Status dropdowns (the fleet's
// FilterMenu, so the ledger filters the way the Fleet card does), a search box, and the working-set /
// archive switch. Options come from the FULL row set so a dropdown never shrinks as you filter.

import { FilterMenu, type FilterOption } from "@/features/standing/overview/FilterMenu";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";
import { STATUS_LABEL, filtersActive, type FollowUpFilters, type FollowUpRow } from "./followupsModel";

export function FollowupsFilterBar({
  rows,
  filters,
  onChange,
  shown,
  orgWideDims = 0,
}: {
  rows: FollowUpRow[];
  filters: FollowUpFilters;
  onChange: (f: FollowUpFilters) => void;
  /** Rows currently shown, for the "N of M" readout. */
  shown: number;
  /** Dimensions open in ≥ half the fleet — the org-wide chip's count; 0 hides the chip. */
  orgWideDims?: number;
}) {
  const uniq = (xs: string[]) => [...new Set(xs)];
  const repoOpts: FilterOption[] = uniq(rows.map((r) => r.repo)).map((v) => ({ value: v, label: v }));
  const dimOpts: FilterOption[] = uniq(rows.map((r) => r.dimId))
    .sort()
    .map((v) => ({ value: v, label: `${v} ${DIMENSION_SHORT[v as DimensionId] ?? ""}`.trim() }));
  const impactOpts: FilterOption[] = ["high", "medium", "low"].map((v) => ({ value: v, label: v }));
  const statusOpts: FilterOption[] = (["open", "in_progress", "done", "dismissed"] as const).map((v) => ({ value: v, label: STATUS_LABEL[v] }));

  const toggle = (k: "repos" | "dims" | "impacts" | "statuses", v: string) => {
    const next = new Set(filters[k]);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange({ ...filters, [k]: next });
  };
  const clear = (k: "repos" | "dims" | "impacts" | "statuses") => onChange({ ...filters, [k]: new Set() });
  const active = filtersActive(filters);
  const archive = filters.statuses.has("done") || filters.statuses.has("dismissed");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterMenu label="Repo" options={repoOpts} selected={filters.repos} onToggle={(v) => toggle("repos", v)} onClear={() => clear("repos")} />
      <FilterMenu label="Dimension" options={dimOpts} selected={filters.dims} onToggle={(v) => toggle("dims", v)} onClear={() => clear("dims")} />
      <FilterMenu label="Impact" options={impactOpts} selected={filters.impacts} onToggle={(v) => toggle("impacts", v)} onClear={() => clear("impacts")} />
      <FilterMenu label="Status" options={statusOpts} selected={filters.statuses} onToggle={(v) => toggle("statuses", v)} onClear={() => clear("statuses")} />
      <input
        type="search"
        value={filters.query}
        onChange={(e) => onChange({ ...filters, query: e.target.value })}
        placeholder="Search gaps…"
        aria-label="Search follow-ups"
        className="focus-ring w-44 rounded-lg border border-divider bg-ink px-2.5 py-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-accent"
      />
      {/* The archive switch is a status shortcut, not a separate mode: it sets statuses to the two
          closed states, so the readout and the table cannot disagree about what is shown. */}
      <button
        type="button"
        onClick={() => onChange({ ...filters, statuses: archive ? new Set() : new Set(["done", "dismissed"]) })}
        aria-pressed={archive}
        className={`focus-ring rounded-full border px-2.5 py-1 font-mono text-xs transition ${archive ? "border-emerald-500/50 text-emerald-400" : "border-divider text-slate-400 hover:border-accent hover:text-white"}`}
      >
        {archive ? "◂ working set" : "resolved archive"}
      </button>
      {orgWideDims > 0 && (
        <button
          type="button"
          onClick={() => onChange({ ...filters, orgWide: !filters.orgWide })}
          aria-pressed={filters.orgWide}
          title="Only dimensions with an open follow-up in at least half the fleet — org problems, to fix once as a practice"
          className={`focus-ring rounded-full border px-2.5 py-1 font-mono text-xs transition ${filters.orgWide ? "border-amber-400/50 text-amber-300" : "border-divider text-slate-400 hover:border-accent hover:text-white"}`}
        >
          org-wide · {orgWideDims}
        </button>
      )}
      <span className="ml-auto font-mono text-xs text-slate-500">
        {shown} of {rows.length}
        {active && (
          <>
            {" · "}
            <button type="button" onClick={() => onChange({ repos: new Set(), dims: new Set(), impacts: new Set(), statuses: new Set(), query: "", orgWide: false })} className="focus-ring rounded text-accent hover:text-white">
              clear filters
            </button>
          </>
        )}
      </span>
    </div>
  );
}
