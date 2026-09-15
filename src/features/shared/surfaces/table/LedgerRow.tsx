"use client";

// One fleet row, memoized on its view model + its own booleans (rung 3): a selection toggle elsewhere
// does not reach it. The view model is precomputed once per data change (rung 2) — the row only places
// strings. `entering` is decided by the parent against the TABLE-scoped seen-set, so a row animates on
// its first appearance and never again for a resort, a refresh or a page it merely returned to; the
// entrance's own `animationend` (bubbling to the ledger) is what marks it. Each commit also reports one
// tick to the render log — a DOM counter, never state — which is what the performance instrument reads.

import { memo, useEffect } from "react";
import { scoreHex } from "@/lib/ui";
import type { Repo } from "./fixtures";
import { COLUMNS } from "./ledger";
import { riseAnimation } from "./sceneParts";

/** Plain display values, formatted when the data arrives, not per render. */
export type RowVM = { id: string; name: string; level: string; score: string; scoreHex: string | null; commits: string; status: Repo["status"]; scanned: string };

export function toVM(r: Repo): RowVM {
  return {
    id: r.id,
    name: r.name,
    level: r.level === null ? "—" : `L${r.level}`,
    score: r.score === null ? "—" : String(r.score),
    scoreHex: r.score === null ? null : scoreHex(r.score),
    commits: r.commits.toLocaleString(),
    status: r.status,
    scanned: r.scannedDaysAgo === null ? "never" : r.scannedDaysAgo === 0 ? "today" : `${r.scannedDaysAgo}d ago`,
  };
}

const STATUS_TONE: Record<Repo["status"], string> = { ok: "text-success-soft", warn: "text-warn", fail: "text-danger", queued: "text-slate-400" };
const CELL = "px-3 py-1.5";

export const LedgerRow = memo(function LedgerRow({
  vm,
  index,
  selected,
  entering,
  reduced,
  onRender,
  onToggle,
}: {
  vm: RowVM;
  index: number;
  selected: boolean;
  entering: boolean;
  reduced: boolean;
  onRender: () => void;
  onToggle: (id: string) => void;
}) {
  useEffect(onRender); // every commit of this row is one tick; memo is what keeps the ticks at one per toggle
  return (
    <tr
      data-id={vm.id}
      data-entered={entering ? "now" : "settled"}
      aria-selected={selected}
      className={`h-9 type-body-sm ${selected ? "bg-accent/5" : ""}`}
      style={{ animation: entering ? riseAnimation(index, reduced) : "none" }}
    >
      <td className={`${CELL} text-slate-200`}>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="accent-[var(--color-accent)]" checked={selected} onChange={() => onToggle(vm.id)} aria-label={`Select ${vm.name}`} />
          <span className="truncate">{vm.name}</span>
        </label>
      </td>
      <td className={`${CELL} text-right font-mono tabular-nums text-slate-300`}>{vm.level}</td>
      <td className={`${CELL} text-right font-mono tabular-nums`} style={{ color: vm.scoreHex ?? undefined }}>
        {vm.score}
      </td>
      <td className={`${CELL} text-right font-mono tabular-nums text-slate-300`}>{vm.commits}</td>
      <td className={`${CELL} type-caption ${STATUS_TONE[vm.status]}`}>{vm.status}</td>
      <td className={`${CELL} text-right font-mono tabular-nums text-slate-400`}>{vm.scanned}</td>
    </tr>
  );
});

/** Column count, for the single-cell body states (empty, error). */
export const COL_SPAN = COLUMNS.length;
