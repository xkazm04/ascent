"use client";

// A sortable column header for TeamsMatrix — extracted so the matrix's own JSX stays under the
// 200-LOC cap (AGENTS.md).

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
        {active && <span className="ml-0.5">{sort.dir === 1 ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
}
