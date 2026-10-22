"use client";

// The Proposals ledger's filter chrome, Prism composition: the same facets and the same FollowUpFilters
// state as FollowupsFilterBar (Repo, Dimension, Impact, Status, plus Source), with the working-set /
// resolved-archive switch and the org-wide scope as kit Segmented controls instead of hand-rolled pills.
import { FilterBar, FilterCount, FilterMenu, Input, Segmented, type FilterOption } from "@/components/kit";
import { STATUS_LABEL, filtersActive, type FollowUpFilters } from "@/components/org/followups/followupsModel";
import { DIMENSION_SHORT } from "@/lib/ui";
import type { DimensionId } from "@/lib/types";
import { SOURCE_LABEL, type ProposalRow } from "./proposalsModel";

type SetKey = "repos" | "dims" | "impacts" | "statuses";
const SOURCES = (["loop", "scan"] as const).map((v) => ({ value: v, label: SOURCE_LABEL[v] }));
const uniq = (xs: string[]) => [...new Set(xs)];

export function ProposalFiltersV2({
  rows,
  filters,
  onChange,
  shown,
  orgWideDims,
  sources,
  onToggleSource,
  onClearSources,
}: {
  rows: readonly ProposalRow[];
  filters: FollowUpFilters;
  onChange: (f: FollowUpFilters) => void;
  shown: number;
  orgWideDims: number;
  sources: Set<string>;
  onToggleSource: (v: string) => void;
  onClearSources: () => void;
}) {
  const opts = {
    repos: uniq(rows.map((r) => r.repo)).map((v) => ({ value: v, label: v })),
    dims: uniq(rows.flatMap((r) => (r.dimId ? [r.dimId] : [])))
      .sort()
      .map((v) => ({ value: v, label: `${v} ${DIMENSION_SHORT[v as DimensionId] ?? ""}`.trim() })),
    impacts: ["high", "medium", "low"].map((v) => ({ value: v, label: v })),
    statuses: (["open", "in_progress", "done", "dismissed"] as const).map((v) => ({ value: v, label: STATUS_LABEL[v] })),
  } satisfies Record<SetKey, FilterOption[]>;
  const toggle = (k: SetKey, v: string) => {
    const next = new Set(filters[k]);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange({ ...filters, [k]: next });
  };
  const menu = (k: SetKey, label: string) => (
    <FilterMenu label={label} options={opts[k]} selected={filters[k]} onToggle={(v) => toggle(k, v)} onClear={() => onChange({ ...filters, [k]: new Set() })} />
  );
  const archive = filters.statuses.has("done") || filters.statuses.has("dismissed");

  return (
    <FilterBar>
      {menu("repos", "Repo")}
      {menu("dims", "Dimension")}
      {menu("impacts", "Impact")}
      {menu("statuses", "Status")}
      <FilterMenu label="Source" options={SOURCES} selected={sources} onToggle={onToggleSource} onClear={onClearSources} />
      <Input
        type="search"
        value={filters.query}
        onChange={(e) => onChange({ ...filters, query: e.target.value })}
        placeholder="Search gaps…"
        aria-label="Search follow-ups"
        className="w-48"
      />
      <Segmented
        label="Which proposals"
        value={archive ? "archive" : "work"}
        onSelect={(k) => onChange({ ...filters, statuses: k === "archive" ? new Set(["done", "dismissed"]) : new Set() })}
        options={[
          { key: "work", label: "Working set" },
          { key: "archive", label: "Resolved archive" },
        ]}
      />
      {orgWideDims > 0 && (
        <Segmented
          label="Scope of gaps"
          value={filters.orgWide ? "org" : "all"}
          onSelect={(k) => onChange({ ...filters, orgWide: k === "org" })}
          options={[
            { key: "all", label: "All gaps" },
            { key: "org", label: `Org-wide · ${orgWideDims}`, title: "Only dimensions with an open follow-up in at least half the fleet: org problems, to fix once as a practice" },
          ]}
        />
      )}
      <FilterCount
        shown={shown}
        total={rows.length}
        active={filtersActive(filters)}
        onClear={() => onChange({ repos: new Set(), dims: new Set(), impacts: new Set(), statuses: new Set(), query: "", orgWide: false })}
      />
    </FilterBar>
  );
}
