"use client";

// sorting: the order contract, read off the live ledger. The column model declares each column's
// semantic type and first direction; the comparator compares by type, sends absent values to one home
// (last, either direction), ranks statuses by declared rank, and ends on identity — so the order is
// total and the same on both tiers. The instrument proves it: ties on the current column, the
// tiebreaker that splits them, a refresh that moves zero rows, and the selection that follows
// identity through a resort.

import { useState } from "react";
import { COLUMNS, DEFAULT_SORT, compare, sortValue } from "./ledger";
import { BTN, Readout, Region } from "./sceneParts";
import type { Ledger } from "./useLedger";

export function SortRegion({ l }: { l: Ledger }) {
  const [moved, setMoved] = useState<number | null>(null);
  const col = COLUMNS.find((c) => c.id === l.shownSort.col) ?? COLUMNS[0];
  const rows = l.windowRows;
  const values = rows.map((r) => sortValue(r, col.id));
  const ties = values.filter((v, i) => i > 0 && v === values[i - 1]).length;
  const absent = values.filter((v) => v === null).length;
  const selectedOnPage = rows.filter((r) => l.selected.has(r.id)).map((r) => r.id);

  // Re-sort the delivered rows with the same comparator: a deterministic order moves nothing.
  const resort = () => {
    const again = [...rows].sort((a, b) => compare(a, b, l.shownSort));
    setMoved(again.filter((r, i) => r.id !== rows[i]?.id).length);
  };

  return (
    <Region technique="sorting" title="A contract about order" note="Total, deterministic, typed. There is always a sort; the tiebreaker is identity; the header announces it.">
      <div className="space-y-1">
        <Readout label="sort" value={<span data-sort={`${l.shownSort.col}:${l.shownSort.dir}`}>{`${l.shownSort.col} ${l.shownSort.dir}`}{l.shownSort.col === DEFAULT_SORT.col && l.shownSort.dir === DEFAULT_SORT.dir ? " (default)" : ""}</span>} />
        <Readout label="compares as" value={col.kind === "text" ? "locale collation, natural numbers" : col.kind === "rank" ? "declared rank, not alphabet" : col.kind === "instant" ? "instant, not display string" : "number"} />
        <Readout label="ties on this page" value={<span data-ties={ties}>{ties}</span>} />
        <Readout label="absent values on this page" value={`${absent} → last, either direction`} />
        <Readout label="tiebreaker" value="id (immutable, unique)" />
        <Readout label="selected, by identity" value={<span data-selected-on-page={selectedOnPage.length}>{selectedOnPage.length ? selectedOnPage.join(", ") : "none"}</span>} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={resort} disabled={rows.length === 0}>
          re-sort identical data
        </button>
        <span className="type-caption text-slate-500" data-moved={moved ?? ""}>
          {moved === null ? "rows moved: —" : `rows moved: ${moved}`}
        </span>
      </div>
      <p className="mt-2 type-caption text-slate-500">
        Click a header: first click takes the type’s natural direction ({col.firstDir} for {col.label.toLowerCase()}), second reverses, third returns to the named default — never to “unsorted”. Tick a row, then resort: the same identity stays ticked wherever it lands.
      </p>
    </Region>
  );
}
