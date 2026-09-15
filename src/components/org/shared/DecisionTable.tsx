"use client";

// THE DECISION TABLE — one ledger shape for every queue a human disposes of: tick rows across the
// fleet, read the batch's arithmetic in a sticky bar, act on all of them at once, or open one row in
// place for its evidence.
//
// Extracted from the Follow-ups worklist (the item-first direction that won the 2026-08-17 prototype
// round) on 2026-09-15, so the In flight group's decision queues — Proposals (scan follow-ups plus the
// loop's pending proposals) and Lessons (the loop's memory candidates) — read and behave identically.
// SHAPE ONLY: the row type, the columns and every action belong to the caller. This owns the
// selection chrome, the in-place expander and the bulk bar, and nothing about what a row means.
//
// Counts ride on every bulk button ("Dismiss 40", never "Dismiss"), and an action whose rows are not
// in the selection is not offered at all — a button that would act on nothing is not a choice.

import { Fragment, useState, type ReactNode } from "react";
import { OrgTable } from "./ui";

export interface DecisionCellContext {
  open: boolean;
  toggleOpen: () => void;
}

export interface DecisionColumn<R> {
  key: string;
  header: ReactNode;
  /** Header tooltip — the column's meaning, where its label is abbreviated. */
  title?: string;
  align?: "left" | "right";
  cell: (row: R, ctx: DecisionCellContext) => ReactNode;
}

export type DecisionTone = "primary" | "positive" | "neutral";

export interface DecisionAction<R> {
  key: string;
  /** The verb. The bar appends the count of selected rows the action applies to. */
  label: string;
  busyLabel: string;
  tone: DecisionTone;
  /** Rows this action can act on; the rest of the selection is left out of `run` and of the count. */
  appliesTo?: (row: R) => boolean;
  /** Print the label alone — for an action that opens a dialog rather than writing. */
  countless?: boolean;
  /** Resolve `false` to KEEP the selection (a dialog that settles later); anything else clears it. */
  run: (rows: R[]) => Promise<boolean | void> | boolean | void;
}

const TONE: Record<DecisionTone, string> = {
  neutral: "rounded-lg border border-divider px-3 py-1.5 type-caption text-slate-300 hover:border-accent hover:text-white",
  positive: "rounded-lg border border-emerald-500/50 px-3 py-1.5 type-caption text-emerald-400 hover:bg-emerald-500/10",
  primary: "rounded-lg bg-accent px-4 py-1.5 type-body-sm font-semibold text-on-accent hover:bg-accent-soft",
};

const always = () => true;

export interface DecisionTableProps<R> {
  caption: string;
  /** The rows to draw — already filtered. */
  rows: readonly R[];
  /** Every row a selection may reference, including rows the current filters hide. Defaults to `rows`. */
  allRows?: readonly R[];
  rowId: (row: R) => string;
  /** The accessible name of the row's checkbox. */
  rowLabel: (row: R) => string;
  columns: readonly DecisionColumn<R>[];
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  /** Rows a batch may include. A settled row has nothing left to decide, so it is not tickable. */
  isSelectable?: (row: R) => boolean;
  /** Dimmed rows (closed, settled). */
  isMuted?: (row: R) => boolean;
  /** The expanded row's body. Omitted → rows do not expand. */
  renderDetail?: (row: R) => ReactNode;
  /** The bulk bar's arithmetic. Defaults to "N selected". */
  summary?: (picked: R[]) => ReactNode;
  actions: readonly DecisionAction<R>[];
  minWidth?: number;
  /** Rendered instead of the table when `rows` is empty. */
  empty?: ReactNode;
}

export function DecisionTable<R>(p: DecisionTableProps<R>) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectable = p.isSelectable ?? always;
  const picked = (p.allRows ?? p.rows).filter((r) => p.selected.has(p.rowId(r)));
  // Select-all covers the SHOWN rows a batch can act on — the same rule the row checkbox enforces.
  const shownSelectable = p.rows.filter(selectable);
  const allShown = shownSelectable.length > 0 && shownSelectable.every((r) => p.selected.has(p.rowId(r)));

  const toggle = (id: string) => {
    const next = new Set(p.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    p.onSelectedChange(next);
  };
  const toggleAll = () => {
    const next = new Set(p.selected);
    for (const r of shownSelectable) {
      if (allShown) next.delete(p.rowId(r));
      else next.add(p.rowId(r));
    }
    p.onSelectedChange(next);
  };
  const run = async (action: DecisionAction<R>) => {
    const target = picked.filter(action.appliesTo ?? always);
    if (target.length === 0) return;
    setBusy(action.key);
    setError(null);
    try {
      if ((await action.run(target)) !== false) p.onSelectedChange(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "That action failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {p.rows.length === 0 ? (
        (p.empty ?? null)
      ) : (
        <OrgTable
          minWidth={p.minWidth ?? 760}
          caption={p.caption}
          head={
            <tr className="text-left">
              <th className="w-8 px-3 py-2">
                <input type="checkbox" checked={allShown} onChange={toggleAll} aria-label="Select all shown" className="accent-accent" />
              </th>
              {p.columns.map((c) => (
                <th key={c.key} title={c.title} className={`px-3 py-2 font-normal ${c.align === "right" ? "text-right" : ""}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          }
        >
          {p.rows.map((r) => {
            const id = p.rowId(r);
            const on = p.selected.has(id);
            const open = expanded === id;
            const ctx: DecisionCellContext = { open, toggleOpen: () => setExpanded(open ? null : id) };
            return (
              <Fragment key={id}>
                <tr className={`${on ? "bg-accent/5" : ""} ${p.isMuted?.(r) ? "opacity-70" : ""}`}>
                  <td className="px-3 py-1.5 align-top">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(id)}
                      disabled={!selectable(r)}
                      aria-label={`Select ${p.rowLabel(r)}`}
                      className="accent-accent"
                    />
                  </td>
                  {p.columns.map((c) => (
                    <td key={c.key} className={`px-3 py-1.5 align-top ${c.align === "right" ? "text-right" : ""}`}>
                      {c.cell(r, ctx)}
                    </td>
                  ))}
                </tr>
                {open && p.renderDetail && (
                  <tr className="!bg-surface/30">
                    <td />
                    <td colSpan={p.columns.length} className="px-3 pb-3 pt-1">
                      {p.renderDetail(r)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </OrgTable>
      )}

      {picked.length > 0 && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-accent/40 bg-surface-strong/95 px-4 py-2.5 shadow-2xl backdrop-blur">
          <span className="type-mono-sm text-slate-200">
            {p.summary ? p.summary(picked) : <><span className="font-bold tabular-nums">{picked.length}</span> selected</>}
          </span>
          <button type="button" onClick={() => p.onSelectedChange(new Set())} className="focus-ring type-label tracking-widest text-slate-500 hover:text-white">
            clear
          </button>
          {error && (
            <span role="alert" className="type-caption text-danger">
              {error}
            </span>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {p.actions.map((a) => {
              const n = picked.filter(a.appliesTo ?? always).length;
              if (n === 0) return null;
              return (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => void run(a)}
                  disabled={busy !== null}
                  className={`focus-ring transition disabled:opacity-50 ${TONE[a.tone]}`}
                >
                  {busy === a.key ? a.busyLabel : a.countless ? a.label : `${a.label} ${n}`}
                </button>
              );
            })}
          </span>
        </div>
      )}
    </>
  );
}
