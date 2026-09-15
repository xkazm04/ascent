"use client";

// A sortable column header for TeamsMatrix — extracted so the matrix's own JSX stays under the
// 200-LOC cap (AGENTS.md).
//
// THE AFFORDANCE CARRIES ITSELF. The section header used to instruct the reader — "Click a header to
// sort" — because the only visible sign a column sorted was the ↓ that appeared AFTER it had been
// clicked. A sentence telling a reader that a control exists is a control that does not read as one
// (docs/ORG-UX-REDESIGN.md §2.2), so every sortable header now carries a dimmed ⇅ at rest. The glyph
// is aria-hidden: `aria-sort` on the <th> plus the button's own title are what a screen reader uses.

export type TeamsMatrixSort = { key: string; dir: 1 | -1 } | null; // dir 1 = desc (best first)

export function TeamsMatrixSortTh({
  id,
  label,
  sort,
  onSort,
  align = "right",
  title,
}: {
  id: string;
  label: string;
  sort: TeamsMatrixSort;
  onSort: (key: string) => void;
  align?: "right" | "center";
  title?: string;
}) {
  const active = sort?.key === id;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === 1 ? "descending" : "ascending") : undefined}
      className={`px-2 py-2 ${align === "center" ? "text-center" : "text-right"}`}
    >
      <button
        type="button"
        onClick={() => onSort(id)}
        title={title ?? `Sort by ${label}`}
        className={`focus-ring rounded uppercase tracking-[0.2em] transition hover:text-white ${active ? "text-accent" : ""}`}
      >
        {label}
        {active ? (
          <span className="ml-0.5" aria-hidden>
            {sort.dir === 1 ? "↓" : "↑"}
          </span>
        ) : (
          <span className="ml-0.5 text-slate-700" aria-hidden>
            ⇅
          </span>
        )}
      </button>
    </th>
  );
}
