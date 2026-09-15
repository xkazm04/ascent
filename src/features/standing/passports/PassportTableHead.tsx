"use client";

// The fleet passport table's sortable header row. Extracted from PassportTable.tsx (200-LOC cap under
// src/features/**); behavior is unchanged — a header click sorts, a second click flips the direction,
// and the active column carries the accent caret.

import type { SortKey, ThSort } from "@/features/standing/passports/passportTableSort";

/** Sortable table-header cell. Declared at module scope (not inside the component) so it isn't
 *  recreated on every render; the sort state it needs is passed in via `sort`. */
function Th({ k, label, align = "left", sort }: { k: SortKey; label: string; align?: "left" | "right"; sort: ThSort }) {
  return (
    <th className={`px-3 py-2 text-${align}`}>
      <button type="button" onClick={() => sort.onSort(k)} className="inline-flex items-center gap-1 uppercase tracking-[0.2em] transition hover:text-slate-200">
        {label}
        <span aria-hidden className={sort.key === k ? "text-accent" : "text-slate-700"}>{sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

export function PassportTableHead({ sort }: { sort: ThSort }) {
  return (
    <tr>
      <Th k="name" label="Repo" sort={sort} />
      <Th k="autoScore" label="Automation" align="right" sort={sort} />
      <Th k="prodScore" label="Production" align="right" sort={sort} />
      <Th k="ci" label="CI" sort={sort} />
      <Th k="tests" label="Tests" sort={sort} />
      <Th k="security" label="Security" sort={sort} />
      <Th k="observability" label="Observability" sort={sort} />
      <th className="w-10 px-2 py-2" aria-label="Expand row" />
    </tr>
  );
}
