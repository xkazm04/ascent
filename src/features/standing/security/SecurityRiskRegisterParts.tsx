"use client";

// Small presentational parts of SecurityRiskRegister.tsx (the coverage tally cell, the D9 score cell
// and the sortable header cell), pulled out so the table's own file stays under the 200-LOC cap.

import { StateSwatch, stateTitle } from "@/components/org/viz";
import type { SortKey } from "./securityRegisterShared";
import { checkTally, type SecurityMatrixInput } from "./securityMatrixModel";

export const TONE: Record<string, string> = {
  ok: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  bad: "border-red-500/40 bg-red-500/10 text-red-300",
  na: "border-slate-800 text-slate-600",
};

/**
 * The Gaps cell — the two counts a row of ten chips could never show at once.
 *
 * The matrix above already carries WHICH control is in which state, per repo. What it cannot do at a
 * glance across a long fleet is answer "how much of this row was never judged", and that is precisely
 * the number a security reviewer must see before reading the rest of the row as a verdict. It is a
 * count, never a grade: an unjudged control has no grade, which is the whole point.
 */
export function CoverageCell({ row }: { row: SecurityMatrixInput }) {
  if (!row.measured) {
    return (
      <span className="inline-flex items-center gap-1.5 type-mono-sm text-slate-600" title={stateTitle("missing", `${row.name} · D9 battery`)}>
        <StateSwatch state="missing" size={12} />
        no battery
      </span>
    );
  }
  const { failing, notJudged, graded } = checkTally(row);
  if (graded === 0 && notJudged === 0) {
    return (
      <span className="type-mono-sm text-slate-600" title="No deterministic checks on this scan. Re-scan to populate the control battery.">
        re-scan for checks
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 type-mono-sm">
      <span className={`rounded border px-1.5 py-0.5 type-caption ${TONE[failing > 0 ? "bad" : "ok"]}`} title={`${failing} of ${graded} graded controls score below 4/10`}>
        {failing} failing
      </span>
      {notJudged > 0 && (
        <span className="inline-flex items-center gap-1 text-slate-400" title={stateTitle("not-judged", `${row.name} · ${notJudged} of ${notJudged + graded} controls`)}>
          <StateSwatch state="not-judged" size={12} />
          {notJudged} not judged
        </span>
      )}
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
