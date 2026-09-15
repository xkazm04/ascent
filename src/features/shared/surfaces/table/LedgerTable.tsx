"use client";

// loading-and-empty-states: the ledger itself. The CHROME — the column header on OrgTable, the
// controls beside it — renders first and always; only the body has a state, and that state is
// `bodyState(inFlight, rows, settled, error)` from ledger.ts. Empty-loading shows geometry-matched
// ghost rows under the header, invisible for their first 150ms; populated-refreshing keeps the rows
// on screen, dimmed, with a busy pill in the chrome; empty-settled names its predicate; error is a
// distinct state with a retry — and a failed refresh over rows keeps them and says how stale they are.

import { useEffect, useMemo, useRef } from "react";
import { OrgTable } from "@/components/org/shared/ui";
import { COLUMNS } from "./ledger";
import { COL_SPAN, LedgerRow, toVM } from "./LedgerRow";
import { BTN, GhostRows, Region } from "./sceneParts";
import type { Ledger } from "./useLedger";

const TH = "px-3 py-2 text-left font-normal";

export function LedgerRegion({ l, reduced }: { l: Ledger; reduced: boolean }) {
  // Rung 2: the view model is derived once per delivered rows, never in the cell path.
  const vms = useMemo(() => l.rows.map(toVM), [l.rows]);
  const refreshing = l.state === "populated-refreshing";
  const staleOverRows = l.error !== null && l.windowRows.length > 0;
  const predicate = l.query.filter ? `matching “${l.query.filter}”` : "with no filter";
  // ONE delegated native listener (React does not bind `animationend` where AnimationEvent is absent):
  // the entrance that just finished marks its identity in the table-scoped seen-set.
  const wrap = useRef<HTMLDivElement>(null);
  const { markSeen } = l;
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onEnd = (e: Event) => {
      const id = (e.target as HTMLElement | null)?.closest<HTMLElement>("[data-id]")?.dataset.id;
      if (id) markSeen(id);
    };
    el.addEventListener("animationend", onEnd);
    return () => el.removeEventListener("animationend", onEnd);
  }, [markSeen]);

  return (
    <Region technique="loading-and-empty-states" title="The fleet ledger" note="Chrome renders first and always; only the body has a state. Rows never yield to their own refresh; empty is asserted after settling; error is not empty.">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={l.refresh} disabled={l.inFlight}>
          refresh
        </button>
        <label className="flex items-center gap-1.5 type-caption text-slate-400">
          <input type="checkbox" className="accent-[var(--color-accent)]" checked={l.failNext} onChange={(e) => l.setFailNext(e.target.checked)} />
          fail the next fetch
        </label>
        <span className="ml-auto inline-flex items-center gap-2 type-caption" aria-live="polite">
          {refreshing ? <span className="inline-flex items-center gap-1.5 rounded-md border border-accent/50 px-2 py-0.5 text-accent-soft"><span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />refreshing</span> : null}
          {staleOverRows ? <span className="rounded-md border border-warn/50 px-2 py-0.5 text-warn">refresh failed · rows are {l.staleRefreshes} refresh{l.staleRefreshes === 1 ? "" : "es"} stale</span> : null}
          <span className="text-slate-600" data-body-state={l.state}>
            {l.state}
          </span>
        </span>
      </div>

      <div ref={wrap} className={refreshing ? "[&_tbody]:opacity-60 [&_tbody]:transition-opacity" : ""} aria-busy={l.inFlight}>
        <OrgTable
          caption="Fictional fleet repositories"
          minWidth={560}
          className="rounded-xl"
          head={
            <tr>
              {COLUMNS.map((c) => {
                const active = l.shownSort.col === c.id;
                return (
                  <th key={c.id} scope="col" className={`${TH} ${c.align === "right" ? "text-right" : ""}`} aria-sort={active ? (l.shownSort.dir === "asc" ? "ascending" : "descending") : undefined}>
                    <button type="button" className={`focus-ring rounded transition hover:text-accent ${active ? "text-accent" : ""}`} onClick={() => l.cycleSort(c.id, c.firstDir)}>
                      {c.label}
                      {active ? (l.shownSort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                  </th>
                );
              })}
            </tr>
          }
        >
          {l.state === "empty-loading" ? <GhostRows count={8} reduced={reduced} /> : null}
          {l.state === "empty-settled" ? (
            <tr>
              <td colSpan={COL_SPAN} className="px-3 py-8 text-center">
                <p className="type-body-sm text-slate-200">No repositories {predicate}.</p>
                <p className="mt-1 type-caption text-slate-500">Your fleet is not gone — this predicate matches nothing.</p>
                {l.query.filter ? (
                  <button type="button" className={`${BTN} mt-2`} onClick={() => l.setFilter("")}>
                    clear the filter
                  </button>
                ) : null}
              </td>
            </tr>
          ) : null}
          {l.state === "error" ? (
            <tr>
              <td colSpan={COL_SPAN} className="px-3 py-8 text-center" role="alert">
                <p className="type-body-sm text-danger">Could not read the fleet.</p>
                <p className="mt-1 type-caption text-slate-500">{l.error} Your query is kept: {predicate}, sorted by {l.query.sort.col}.</p>
                <button type="button" className={`${BTN} mt-2`} onClick={l.refresh}>
                  retry
                </button>
              </td>
            </tr>
          ) : null}
          {vms.map((vm, i) => (
            <LedgerRow key={vm.id} vm={vm} index={i} selected={l.selected.has(vm.id)} entering={!l.seen.has(vm.id)} reduced={reduced} onRender={l.onRowRender} onToggle={l.toggle} />
          ))}
          {l.state.startsWith("populated") && vms.length === 0 ? (
            <tr>
              <td colSpan={COL_SPAN} className="px-3 py-4 text-center type-caption text-slate-500">
                Nothing in these {l.windowRows.length} loaded rows matches “{l.quickFind}”.
              </td>
            </tr>
          ) : null}
        </OrgTable>
      </div>
    </Region>
  );
}
