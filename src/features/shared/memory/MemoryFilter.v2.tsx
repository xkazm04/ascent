"use client";

// Same server filters as the Altimeter bar: search, namespace, kind, source, sort. Each control
// keeps its accessible name. Ids are filter-scoped so they do not collide with the author form.
import { FormField, Input, Select } from "@/components/kit";
import { MEMORY_KIND_LABEL, REPO_MEMORY_SOURCE, SCAN_PIPELINE_SOURCE, type MemoryKind } from "@/lib/org/memory-kinds";
import type { MemorySort } from "@/lib/db";

const SORTS: { id: MemorySort; label: string }[] = [
  { id: "recent", label: "Recently updated" },
  { id: "confidence", label: "Most trusted" },
  { id: "recalls", label: "Most recalled" },
];

const SOURCES = [
  { id: SCAN_PIPELINE_SOURCE, label: "From scans" },
  { id: REPO_MEMORY_SOURCE, label: "From repos" },
];

export function MemoryFilterV2({
  search,
  setSearch,
  namespace,
  setNamespace,
  kind,
  setKind,
  source,
  setSource,
  sort,
  setSort,
  kinds,
  namespaces,
}: {
  search: string;
  setSearch: (v: string) => void;
  namespace: string;
  setNamespace: (v: string) => void;
  kind: string;
  setKind: (v: string) => void;
  source: string;
  setSource: (v: string) => void;
  sort: MemorySort;
  setSort: (v: MemorySort) => void;
  kinds: readonly string[];
  namespaces: string[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <FormField label="Search" htmlFor="mem-filter-search">
        <Input
          id="mem-filter-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memories…"
          aria-label="Search memories"
        />
      </FormField>
      {namespaces.length > 0 && (
        <FormField label="Namespace" htmlFor="mem-filter-namespace">
          <Select id="mem-filter-namespace" value={namespace} onChange={(e) => setNamespace(e.target.value)} aria-label="Filter by namespace">
            <option value="">All namespaces</option>
            {namespaces.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      <FormField label="Kind" htmlFor="mem-filter-kind">
        <Select id="mem-filter-kind" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter by kind">
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {MEMORY_KIND_LABEL[k as MemoryKind] ?? k}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Source" htmlFor="mem-filter-source">
        <Select id="mem-filter-source" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Filter by source">
          <option value="">All sources</option>
          {SOURCES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Sort" htmlFor="mem-filter-sort">
        <Select id="mem-filter-sort" value={sort} onChange={(e) => setSort(e.target.value as MemorySort)} aria-label="Sort memories">
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </Select>
      </FormField>
    </div>
  );
}
