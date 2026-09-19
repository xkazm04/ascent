// An `athena:table`, drawn with the fleet's own table chrome (OrgTable) so a table she draws and a
// table the dashboard draws are the same object — one hairline border, one header treatment, one row
// rule, one scroll container.
//
// `minWidth` is derived from the column count rather than left at OrgTable's 640px default: this
// table lives in a ~28rem drawer, and a fixed 640 would force a horizontal scrollbar onto a
// two-column answer that fits comfortably. Wide tables still scroll inside their own container —
// the drawer never scrolls sideways.
//
// The caps are NOT re-applied here. `model.ts` already clipped the block to the exported
// `ATHENA_TABLE_MAX_*` constants on the way out of `meta`; doing it twice would be two places to
// disagree.

import { OrgTable } from "@/components/org/shared/ui";
import type { AthenaTableBlock } from "@/lib/athena/blocks";

/** Columns after the first are numeric far more often than not, so they are typeset and right-set. */
const cellClass = (i: number) =>
  i === 0 ? "px-3 py-2 text-slate-200" : "px-3 py-2 text-right font-mono tabular-nums text-slate-300";

export function AthenaTable({ block }: { block: AthenaTableBlock }) {
  return (
    <div>
      {block.title && (
        <div className="px-4 pb-1.5 type-label tracking-widest text-slate-500">{block.title}</div>
      )}
      <OrgTable
        className="rounded-none border-x-0"
        minWidth={Math.max(240, block.columns.length * 108)}
        caption={block.title ?? "Table"}
        head={
          <tr>
            {block.columns.map((c, i) => (
              <th key={i} scope="col" className={i === 0 ? "px-3 py-2 text-left" : "px-3 py-2 text-right"}>
                {c}
              </th>
            ))}
          </tr>
        }
      >
        {block.rows.map((row, r) => (
          <tr key={r}>
            {row.map((cell, i) => (
              <td key={i} className={cellClass(i)}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </OrgTable>
    </div>
  );
}
