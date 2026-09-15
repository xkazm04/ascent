"use client";

// Extracted from MemoryPanel — the server-filtered controls (search · namespace · kind · sort). State
// lives in MemoryPanel and is passed in as props. Mirrors SkillsPanel.FilterBar; the namespace select is
// populated from the org's OWN namespaces (listOrgMemoryNamespaces), so it never offers an empty filter.

import {
  MEMORY_KIND_LABEL,
  REPO_MEMORY_SOURCE,
  SCAN_PIPELINE_SOURCE,
  type MemoryKind,
} from "@/lib/org/memory-kinds";
import type { MemorySort } from "@/lib/db";

const SORTS: { id: MemorySort; label: string }[] = [
  { id: "recent", label: "Recently updated" },
  { id: "confidence", label: "Most trusted" },
  { id: "recalls", label: "Most recalled" },
];

// PROVENANCE (moonshot #14). The three machine/human origins a reader needs to tell apart, and the
// reason the filter exists at all: "a colleague claimed this", "the pipeline observed this" and "an
// agent wrote this in a repo" are three different levels of evidence wearing the same card.
// "Authored" is the ABSENCE of a machine source rather than a value, so it is not offered as an exact
// match here — the two auto sources are, and clearing the filter shows everything.
const SOURCES: { id: string; label: string }[] = [
  { id: SCAN_PIPELINE_SOURCE, label: "From scans" },
  { id: REPO_MEMORY_SOURCE, label: "From repos" },
];

const selectClass =
  "rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 type-mono-sm text-slate-200";

export function MemoryFilterBar({
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
    /* Filter bar — server-filtered (search · namespace · kind · sort). */
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search memories…"
        aria-label="Search memories"
        className="min-w-[10rem] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 type-body-sm text-slate-200 placeholder:text-slate-600"
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
        value={source}
        onChange={(e) => setSource(e.target.value)}
        aria-label="Filter by source"
        className={selectClass}
      >
        <option value="">All sources</option>
        {SOURCES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
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
