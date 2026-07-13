"use client";

// Extracted from MemoryPanel — the server-filtered controls (search · namespace · kind · sort). State
// lives in MemoryPanel and is passed in as props. Mirrors SkillsPanel.FilterBar; the namespace select is
// populated from the org's OWN namespaces (listOrgMemoryNamespaces), so it never offers an empty filter.

import { MEMORY_KIND_LABEL, type MemoryKind } from "@/lib/org/memory-kinds";
import type { MemorySort } from "@/lib/db";

const SORTS: { id: MemorySort; label: string }[] = [
  { id: "recent", label: "Recently updated" },
  { id: "confidence", label: "Most trusted" },
  { id: "recalls", label: "Most recalled" },
];

const selectClass =
  "rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200";

export function MemoryFilterBar({
  search,
  setSearch,
  namespace,
  setNamespace,
  kind,
  setKind,
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
  sort: MemorySort;
  setSort: (v: MemorySort) => void;
  kinds: readonly string[];
  namespaces: string[];
}) {
  return (
    /* Filter bar — server-filtered (search · namespace · kind · sort). */
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search memories…"
        aria-label="Search memories"
        className="min-w-[10rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
      />
      {namespaces.length > 0 && (
        <select
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          aria-label="Filter by namespace"
          className={selectClass}
        >
          <option value="">All namespaces</option>
          {namespaces.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        aria-label="Filter by kind"
        className={selectClass}
      >
        <option value="">All kinds</option>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {MEMORY_KIND_LABEL[k as MemoryKind] ?? k}
          </option>
        ))}
      </select>
      <select
        value={sort}
        onChange={(e) => setSort(e.target.value as MemorySort)}
        aria-label="Sort memories"
        className={selectClass}
      >
        {SORTS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
