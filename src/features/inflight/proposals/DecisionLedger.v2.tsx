"use client";

// The Prism decision ledger: the In flight queues (Proposals, Lessons) drawn from kit parts. Same contract
// as the shared DecisionTable (tick rows, read the batch arithmetic, act on all of them, open one row in
// place) with a ruled DataTable and a bar built of Frame + PrimaryAction/GhostAction. The row type, columns
// and every action belong to the caller; the column and action shapes are structurally the DecisionTable's,
// so a caller's column set feeds both compositions unchanged.
import { Fragment, useState, type ReactNode } from "react";
import { CELL, DataTable, Frame, GhostAction, HEAD_CELL, PrimaryAction } from "@/components/kit";

export interface LedgerCellContext {
  open: boolean;
  toggleOpen: () => void;
}
export interface LedgerColumn<R> {
  key: string;
  header: ReactNode;
  title?: string;
  align?: "left" | "right";
  cell: (row: R, ctx: LedgerCellContext) => ReactNode;
}
export interface LedgerAction<R> {
  key: string;
  label: string;
  busyLabel: string;
  /** `primary` is the batch's one paper action; the rest are ghosts. */
  tone: "primary" | "positive" | "neutral";
  appliesTo?: (row: R) => boolean;
  countless?: boolean;
  run: (picked: R[]) => Promise<void | boolean> | void | boolean;
}

const always = () => true;
const ALIGN = (a?: "left" | "right") => (a === "right" ? "text-right" : "");

export function DecisionLedgerV2<R>(p: {
  caption: string;
  rows: readonly R[];
  allRows?: readonly R[];
  rowId: (row: R) => string;
  rowLabel: (row: R) => string;
  columns: readonly LedgerColumn<R>[];
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  isSelectable?: (row: R) => boolean;
  isMuted?: (row: R) => boolean;
  renderDetail?: (row: R) => ReactNode;
  summary?: (picked: R[]) => ReactNode;
  actions: readonly LedgerAction<R>[];
  minWidth?: number;
  empty?: ReactNode;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectable = p.isSelectable ?? always;
  const picked = (p.allRows ?? p.rows).filter((r) => p.selected.has(p.rowId(r)));
  const shownIds = new Set(p.rows.map(p.rowId));
  const isHidden = (r: R) => !shownIds.has(p.rowId(r));
  const hidden = picked.filter(isHidden);
  const shownSelectable = p.rows.filter(selectable);
  const allShown = shownSelectable.length > 0 && shownSelectable.every((r) => p.selected.has(p.rowId(r)));

  const change = (fn: (next: Set<string>) => void) => {
    const next = new Set(p.selected);
    fn(next);
    p.onSelectedChange(next);
  };
  const toggle = (id: string) => change((n) => (n.has(id) ? n.delete(id) : n.add(id)));
  const toggleAll = () => change((n) => shownSelectable.forEach((r) => (allShown ? n.delete(p.rowId(r)) : n.add(p.rowId(r)))));
  const run = async (action: LedgerAction<R>) => {
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
        <DataTable
          variant="plain"
          size="sm"
          minWidth={p.minWidth ?? 760}
          caption={p.caption}
          head={
            <tr>
              <th className="w-8 px-3 py-3">
                <input type="checkbox" checked={allShown} onChange={toggleAll} aria-label="Select all shown" className="accent-accent" />
              </th>
              {p.columns.map((c) => (
                <th key={c.key} title={c.title} className={`${HEAD_CELL} ${ALIGN(c.align)}`}>
                  {c.header}
                </th>
              ))}
            </tr>
          }
        >
          {p.rows.map((r) => {
            const id = p.rowId(r);
            const open = expanded === id;
            const ctx: LedgerCellContext = { open, toggleOpen: () => setExpanded(open ? null : id) };
            return (
              <Fragment key={id}>
                <tr data-selected={p.selected.has(id) ? "" : undefined} className={`border-b border-divider ${p.isMuted?.(r) ? "opacity-70" : ""}`}>
                  <td className="px-3 py-3 align-top">
                    <input
                      type="checkbox"
                      checked={p.selected.has(id)}
                      onChange={() => toggle(id)}
                      disabled={!selectable(r)}
                      aria-label={`Select ${p.rowLabel(r)}`}
                      className="accent-accent"
                    />
                  </td>
                  {p.columns.map((c) => (
                    <td key={c.key} className={`${CELL} align-top ${ALIGN(c.align)}`}>
                      {c.cell(r, ctx)}
                    </td>
                  ))}
                </tr>
                {open && p.renderDetail && (
                  <tr className="border-b border-divider">
                    <td />
                    <td colSpan={p.columns.length} className="px-4 pb-4 pt-1">
                      {p.renderDetail(r)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </DataTable>
      )}

      {picked.length > 0 && (
        <div className="sticky bottom-4 z-10 mt-3">
          <Frame edge="both" pad="sm" aria-label="Act on the selected rows">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <p className="type-body-sm text-white">
                {p.summary ? p.summary(picked) : <span className="tabular-nums">{picked.length} selected</span>}
                {hidden.length > 0 && <span className="text-slate-400"> · {hidden.length} hidden by the current filter</span>}
              </p>
              {hidden.length > 0 && (
                <button type="button" onClick={() => change((n) => hidden.forEach((r) => n.delete(p.rowId(r))))} className="focus-ring type-caption text-slate-400 hover:text-white">
                  Drop hidden
                </button>
              )}
              <button type="button" onClick={() => p.onSelectedChange(new Set())} className="focus-ring type-caption text-slate-400 hover:text-white">
                Clear
              </button>
              {error && (
                <span role="alert" className="type-caption text-slate-100">
                  ! {error}
                </span>
              )}
              <span className="ml-auto flex flex-wrap items-center gap-3">
                {p.actions.map((a) => {
                  const target = picked.filter(a.appliesTo ?? always);
                  if (target.length === 0) return null;
                  const h = target.filter(isHidden).length;
                  const text = busy === a.key ? a.busyLabel : a.countless ? a.label : `${a.label} ${target.length}${h > 0 ? ` (${h} hidden)` : ""}`;
                  const Action = a.tone === "primary" ? PrimaryAction : GhostAction;
                  return (
                    <Action key={a.key} onClick={() => void run(a)} disabled={busy !== null}>
                      {text}
                    </Action>
                  );
                })}
              </span>
            </div>
          </Frame>
        </div>
      )}
    </>
  );
}
