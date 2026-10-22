"use client";

// SortHead: a sortable column head. The whole label is one button; the sort direction is a glyph AND
// aria-sort on the <th>, so it is never colour alone. `idle` shows a neutral glyph on unsorted columns.
import type { ReactNode } from "react";

export type SortDir = "asc" | "desc";

export function SortHead({
  children,
  active,
  dir = "asc",
  onSort,
  title,
  align = "left",
  dense = false,
  idle = false,
  after,
}: {
  children: ReactNode;
  active: boolean;
  dir?: SortDir;
  onSort: () => void;
  title?: string;
  align?: "left" | "center" | "right";
  /** Matrix heads: tight horizontal padding. */
  dense?: boolean;
  /** Show a neutral sort glyph on an unsorted column. */
  idle?: boolean;
  /** Content after the button, inside the head cell (a badge). */
  after?: ReactNode;
}) {
  const glyph = active ? (dir === "asc" ? "▲" : "▼") : idle ? "↕" : "";
  return (
    <th
      scope="col"
      data-kit="sort-head"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
      className={`${dense ? "px-2" : "px-4"} py-3 font-normal text-${align}`}
    >
      <button
        type="button"
        onClick={onSort}
        title={title}
        data-role="sort-button"
        className={`focus-ring inline-flex items-center gap-1.5 rounded px-1 transition hover:text-white ${active ? "text-white" : ""}`}
      >
        {children}
        {glyph && (
          <span aria-hidden className={active ? "text-white" : "text-slate-500"}>
            {glyph}
          </span>
        )}
      </button>
      {after}
    </th>
  );
}
