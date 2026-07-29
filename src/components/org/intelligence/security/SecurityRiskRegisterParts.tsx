"use client";

// Small presentational parts of SecurityRiskRegister.tsx (the check-grade chip + sortable header
// cell), pulled out so the table's own file stays under the 200-LOC cap (docs/ORG-TABS-REFACTOR.md).

import { gradeTone, type SortKey } from "./securityRegisterShared";
import type { SecurityRowCheck } from "@/lib/org/security";

export const TONE: Record<string, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  bad: "border-red-500/40 bg-red-500/10 text-red-300",
  na: "border-slate-800 text-slate-600",
};

export function CheckChip({ short, check }: { short: string; check?: SecurityRowCheck }) {
  const tone = gradeTone(check?.score ?? null);
  const grade = !check || check.score === null ? "n/a" : `${check.score}/10`;
  const title = check ? `${check.name} (${check.risk}) — ${grade}: ${check.detail}` : `${short}: not evaluated in this scan`;
  return (
    <span title={title} className={`rounded border px-1.5 py-0.5 font-mono text-xs ${TONE[tone]}`}>
      {short}
    </span>
  );
}

export type ThSort = { key: SortKey; dir: "asc" | "desc"; onSort: (k: SortKey) => void };

/** Sortable table-header cell. Declared at module scope (not inside the component) so it isn't
 *  recreated on every render; the sort state it needs is passed in via `sort`. `badge` renders a small
 *  provenance chip next to the label (e.g. the advisories column's "demo data" marker). */
export function Th({ k, label, align = "left", title, sort, badge }: { k: SortKey; label: string; align?: "left" | "center" | "right"; title?: string; sort: ThSort; badge?: React.ReactNode }) {
  return (
    <th className={`px-3 py-2 text-${align}`} aria-sort={sort.key === k ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" onClick={() => sort.onSort(k)} title={title} className="inline-flex items-center gap-1 uppercase tracking-[0.2em] transition hover:text-slate-200">
        {label}
        <span aria-hidden className={sort.key === k ? "text-accent" : "text-slate-700"}>{sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
      {badge}
    </th>
  );
}
